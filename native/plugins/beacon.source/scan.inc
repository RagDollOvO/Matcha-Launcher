// Cold-path scan of executable PE sections, shared by version-specific adapters.
unsigned char* find_unique(const wchar_t* module,const int* pattern,size_t length,uint32_t& count){
    count=0;auto base=reinterpret_cast<unsigned char*>(GetModuleHandleW(module));if(!readable(base,sizeof(IMAGE_DOS_HEADER)))return nullptr;
    auto dos=reinterpret_cast<IMAGE_DOS_HEADER*>(base);if(dos->e_magic!=IMAGE_DOS_SIGNATURE||dos->e_lfanew<0||dos->e_lfanew>1024*1024)return nullptr;
    auto nt=reinterpret_cast<IMAGE_NT_HEADERS32*>(base+dos->e_lfanew);
    if(!readable(nt,sizeof(*nt))||nt->Signature!=IMAGE_NT_SIGNATURE||nt->OptionalHeader.Magic!=IMAGE_NT_OPTIONAL_HDR32_MAGIC)return nullptr;
    auto sections=IMAGE_FIRST_SECTION(nt);if(!readable(sections,nt->FileHeader.NumberOfSections*sizeof(*sections)))return nullptr;
    unsigned char* found=nullptr;
    for(unsigned i=0;i<nt->FileHeader.NumberOfSections;++i){auto& sec=sections[i];if(!(sec.Characteristics&IMAGE_SCN_MEM_EXECUTE))continue;
        const size_t n=sec.Misc.VirtualSize;if(sec.VirtualAddress>nt->OptionalHeader.SizeOfImage||n>nt->OptionalHeader.SizeOfImage-sec.VirtualAddress)continue;
        auto text=base+sec.VirtualAddress;if(!readable(text,n)||n<length)continue;
        for(size_t offset=0;offset+length<=n;++offset){bool match=true;
            for(size_t k=0;k<length;++k)if(pattern[k]>=0&&text[offset+k]!=pattern[k]){match=false;break;}
            if(match){found=text+offset;if(++count>1)return nullptr;}
        }
    }return count==1?found:nullptr;
}
