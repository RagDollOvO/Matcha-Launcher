#pragma once
#include "common.hpp"
#include <wincrypt.h>
#include <nlohmann/json.hpp>
#include <map>
#include <set>
#include <memory>
#include <algorithm>
#include <cstring>
#include <cctype>

// Shared by the read-only CLI verifier and the actual pre-LoadLibrary gate.
// CMS is Windows' PKCS#7 implementation. Trust pins live outside plugin packages.
namespace beacon {
namespace fs = std::filesystem;
using json = nlohmann::json;
inline void require(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
inline std::string sha256(const BYTE* data, size_t size) {
    BYTE hash[32]; DWORD length = sizeof(hash);
    require(size <= MAXDWORD && CryptHashCertificate2(BCRYPT_SHA256_ALGORITHM, 0, nullptr, data, DWORD(size), hash, &length), "release_hash_failed");
    const char* digits = "0123456789abcdef"; std::string out;
    for (BYTE c : hash) { out += digits[c >> 4]; out += digits[c & 15]; } return out;
}
inline std::string sha256(const std::vector<BYTE>& b) { return sha256(b.data(), b.size()); }
inline bool hash_string(const std::string& s) { return s.size() == 64 && s.find_first_not_of("0123456789abcdef") == std::string::npos; }
inline bool same_path(const fs::path& a, const fs::path& b) { return !_wcsicmp(a.c_str(), b.c_str()); }
struct Gate {
    json report = {{"state", "unverified"}, {"signature", "absent"}, {"integrity", "unverified"}, {"channel", "local"}};
    std::vector<std::unique_ptr<l4p::Handle>> locks;
    std::set<std::wstring> system_imports;
    std::map<std::wstring,fs::path> package_imports;
    void prepare_runtime() {
        // Resolve external imports from System32 before the plugin DllMain.
        // A newly inserted local DLL then cannot win a post-check search.
        for(const auto& name:system_imports) {
            HMODULE module=LoadLibraryExW(name.c_str(),nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);
            require(module && l4p::pin(module),"release_system_dependency_load_failed");
        }
        // System preloads can bring in transitive modules. Check package names
        // again after that changed the process module inventory.
        for(const auto& item:package_imports) if(auto module=GetModuleHandleW(item.first.c_str()))
            require(same_path(fs::canonical(l4p::module_path(module)),item.second),"release_dependency_collision");
    }
    std::vector<BYTE> read(const fs::path& file, size_t limit = 256 * 1024 * 1024) {
        auto h = std::make_unique<l4p::Handle>(CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, nullptr));
        require(h->value != INVALID_HANDLE_VALUE, "release_file_locked_or_missing");
        BY_HANDLE_FILE_INFORMATION info{}; LARGE_INTEGER size{};
        require(GetFileInformationByHandle(h->value, &info) && !(info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)), "release_unsafe_file");
        require(GetFileSizeEx(h->value, &size) && size.QuadPart >= 0 && size.QuadPart <= static_cast<LONGLONG>(limit), "release_file_too_large");
        std::vector<BYTE> bytes(static_cast<size_t>(size.QuadPart)); DWORD count = 0;
        require(ReadFile(h->value, bytes.data(), DWORD(bytes.size()), &count, nullptr) && count == bytes.size(), "release_read_failed");
        locks.push_back(std::move(h)); return bytes;
    }
    void directory(const fs::path& dir) {
        auto h = std::make_unique<l4p::Handle>(CreateFileW(dir.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE,
            nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr));
        BY_HANDLE_FILE_INFORMATION info{};
        require(h->value != INVALID_HANDLE_VALUE && GetFileInformationByHandle(h->value, &info)
            && !(info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY), "release_unsafe_directory");
        locks.push_back(std::move(h));
    }
    json document(const fs::path& file) { auto b = read(file, 1024 * 1024); return json::parse(b); }
};
inline bool portable(const std::string& name) {
    if (name.empty() || name.size() > 200 || name.front() == '/' || name.back() == '/') return false;
    size_t start = 0;
    while (start < name.size()) {
        auto end = name.find('/', start); if (end == std::string::npos) end = name.size();
        auto part = name.substr(start, end - start);
        if (part.empty() || part.front() == '.' || part.back() == '.' || part.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789._-") != std::string::npos) return false;
        auto base = part.substr(0, part.find('.')); if (!l4p::valid_id(base)) return false;
        start = end + 1;
    } return true;
}
// Inspect normal imports without mapping a DLL. Signed v1 packages use eager
// imports and flat DLL names; delayed/dynamic loading requires a future profile.
inline std::vector<std::string> imports(const std::vector<BYTE>& b) {
    auto u16 = [&](size_t p) { require(p <= b.size() && b.size()-p >= 2, "release_invalid_pe"); WORD v; std::memcpy(&v,b.data()+p,2); return v; };
    auto u32 = [&](size_t p) { require(p <= b.size() && b.size()-p >= 4, "release_invalid_pe"); DWORD v; std::memcpy(&v,b.data()+p,4); return v; };
    require(u16(0) == 0x5a4d, "release_invalid_pe"); size_t pe = u32(0x3c);
    require(pe <= b.size() && b.size()-pe >= 24,"release_invalid_pe");
    require(u32(pe) == 0x4550 && u16(pe+4) == 0x14c && (u16(pe+22)&0x2000), "release_expected_x86_dll");
    size_t opt = pe+24; require(u16(opt) == 0x10b && u16(pe+20) >= 224, "release_invalid_pe");
    auto rva = [&](uint64_t address, size_t length) -> size_t {
        require(address<=MAXDWORD,"release_invalid_pe_rva");
        for (size_t i=0; i<u16(pe+6); ++i) {
            size_t s = opt+u16(pe+20)+i*40; auto va=u32(s+12), raw=u32(s+20), size=u32(s+16);
            if (address >= va && address-va+length <= size) { uint64_t p=uint64_t(raw)+address-va; require(p+length<=b.size(), "release_invalid_pe"); return size_t(p); }
        } throw std::runtime_error("release_invalid_pe_rva");
    };
    require(u32(opt+92) >= 14 && !u32(opt+96+13*8), "release_delay_import_unsupported");
    std::vector<std::string> out; DWORD address = u32(opt+104);
    if (!address) return out;
    for (size_t i=0; i<1024; ++i) {
        size_t p=rva(uint64_t(address)+i*20,20); DWORD name=u32(p+12); if (!name) return out;
        std::string s;
        for(size_t k=0; k<256; ++k) { char c=char(b[rva(uint64_t(name)+k,1)]); if(!c) break; s+=char(std::tolower(static_cast<unsigned char>(c))); }
        require(portable(s) && s.find('/') == std::string::npos && s.size()<256, "release_invalid_import"); out.push_back(s);
    } throw std::runtime_error("release_import_limit");
}
inline std::unique_ptr<Gate> verify(const fs::path& root, const fs::path& policy_file, const std::string& expected = "") {
    auto gate=std::make_unique<Gate>();
    // Lock all path components so parent rename/junction substitution cannot
    // swap the checked tree during DLL loading. Payload locks survive to exit.
    auto absolute=fs::absolute(root).lexically_normal();
    for(auto p=absolute; p.has_relative_path(); p=p.parent_path()) gate->directory(p);
    bool has_release=fs::exists(root/L"release.json"), has_signature=fs::exists(root/L"release.p7s");
    if (!has_release && !has_signature && expected.empty()) {
        if(fs::exists(root/L".l4p-package.json")) require(gate->document(root/L".l4p-package.json").value("releaseSha256", "").empty(), "release_removed");
        return gate;
    }
    require(has_release && has_signature, "release_signature_missing");
    auto content=gate->read(root/L"release.json", 1024*1024), sig=gate->read(root/L"release.p7s", 1024*1024);
    auto release_hash=sha256(content); require(expected.empty() || expected==release_hash, "release_version_binding_changed");
    auto policy=gate->document(policy_file);
    require(policy.at("schemaVersion")==1, "release_policy_version");
    auto revoked=[&](const char* key, const std::string& value) { const auto& list=policy.at(key); require(list.is_array(),"release_invalid_policy"); return std::find(list.begin(),list.end(),value)!=list.end(); };
    require(!revoked("revokedReleases",release_hash), "release_revoked");
    CRYPT_VERIFY_MESSAGE_PARA para{}; para.cbSize=sizeof(para); para.dwMsgAndCertEncodingType=X509_ASN_ENCODING|PKCS_7_ASN_ENCODING;
    const BYTE* data=content.data(); DWORD size=DWORD(content.size()); PCCERT_CONTEXT cert=nullptr;
    require(CryptVerifyDetachedMessageSignature(&para,0,sig.data(),DWORD(sig.size()),1,&data,&size,&cert), "release_signature_invalid");
    std::unique_ptr<const CERT_CONTEXT, decltype(&CertFreeCertificateContext)> owner(cert,CertFreeCertificateContext);
    require(CertVerifyTimeValidity(nullptr,cert->pCertInfo)==0, "release_signer_expired");
    auto pin=sha256(cert->pbCertEncoded,cert->cbCertEncoded); require(!revoked("revokedSigners",pin), "release_signer_revoked");
    json signer=nullptr;
    for(const auto& item:policy.at("signers")) if(item.at("certificateSha256")==pin) { require(signer.is_null(),"release_duplicate_pin"); signer=item; }
    require(!signer.is_null(), "release_signer_untrusted");
    // The offline profile intentionally only issues development trust.
    require(signer.at("channel")=="development", "release_channel_unsupported");
    auto release=json::parse(content); auto manifest=gate->document(root/L"manifest.json");
    require(release.at("schemaVersion")==1 && release.at("id")==manifest.at("id") && release.at("version")==manifest.at("version"), "release_identity_mismatch");
    require(release.at("files").is_array() && release["files"].size()<=4096, "release_inventory_invalid");
    std::set<std::string> files; std::map<std::string,std::vector<std::string>> dlls;
    for(const auto& item:release.at("files")) {
        auto name=item.at("path").get<std::string>(), hash=item.at("sha256").get<std::string>();
        require(portable(name) && hash_string(hash) && name!="config.json" && name!="release.json" && name!="release.p7s" && files.insert(name).second,"release_inventory_path");
        auto file=root/l4p::wide(name);
        for(auto p=file.parent_path(); !same_path(p,root); p=p.parent_path()) gate->directory(p);
        auto bytes=gate->read(file); require(item.at("size")==bytes.size() && sha256(bytes)==hash, "release_file_changed");
        if(file.extension()==L".dll") { require(file.parent_path()==root,"release_nested_dll_unsupported"); dlls[name]=imports(bytes); }
    }
    require(files.count("manifest.json") && files.count("plugin.dll"), "release_inventory_incomplete");
    for(const auto& item:fs::recursive_directory_iterator(root)) {
        auto attr=GetFileAttributesW(item.path().c_str()); require(attr!=INVALID_FILE_ATTRIBUTES && !(attr&FILE_ATTRIBUTE_REPARSE_POINT),"release_unsafe_path");
        if(item.is_directory()) { gate->directory(item.path()); continue; }
        auto name=l4p::utf8(item.path().lexically_relative(root).generic_wstring());
        require(files.count(name) || name=="release.json" || name=="release.p7s" || name==".l4p-package.json" || name=="config.json", "release_unlisted_file");
    }
    // Reject DLL name collisions with modules loaded from outside this package
    // and System32 before any plugin DllMain runs.
    wchar_t sys[MAX_PATH]; require(GetSystemDirectoryW(sys,MAX_PATH)>0,"release_system_directory");
    auto system=fs::canonical(sys);
    for(const auto& entry:dlls) for(const auto& name:entry.second) {
        bool api_set=name.rfind("api-ms-win-",0)==0 || name.rfind("ext-ms-win-",0)==0;
        bool packaged=dlls.count(name);
        if(auto module=GetModuleHandleW(l4p::wide(name).c_str())) {
            auto actual=fs::canonical(l4p::module_path(module));
            require(packaged ? same_path(actual,fs::canonical(root/l4p::wide(name))) : same_path(actual.parent_path(),system), "release_dependency_collision");
        }
        require(packaged || api_set || fs::is_regular_file(system/l4p::wide(name)),"release_dependency_missing");
        if(!packaged) gate->system_imports.insert(api_set ? l4p::wide(name) : (system/l4p::wide(name)).wstring());
        else gate->package_imports[l4p::wide(name)]=fs::canonical(root/l4p::wide(name));
    }
    gate->report={{"state","verified-development"},{"channel","development"},{"signature","verified"},{"integrity","verified"},
        {"releaseSha256",release_hash},{"signer",signer.at("identity")},{"certificateSha256",pin},{"source",release.value("source",json::object())},
        {"build",release.value("build",json::object())},{"behaviorReview",release.value("behaviorReview",json{{"status","pending"}})},
        {"evidenceOrigin","signed-publisher-statements"},{"fileCount",files.size()}};
    return gate;
}
}
