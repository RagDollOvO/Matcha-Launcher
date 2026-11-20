#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <cstdio>

// RecycleItem returns the item in the bin; never substitute RemoveItem on an unsupported volume.
int wmain(int argc, wchar_t** argv) {
  if (argc != 2) return 2;
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(hr)) return 3;
  IShellItem *item=nullptr, *parent=nullptr, *bin=nullptr, *result=nullptr;
  ITransferSource *source=nullptr;
  hr = SHCreateItemFromParsingName(argv[1], nullptr, IID_PPV_ARGS(&item));
  if (SUCCEEDED(hr)) hr=item->GetParent(&parent);
  if (SUCCEEDED(hr)) hr=parent->BindToHandler(nullptr, BHID_Transfer, IID_PPV_ARGS(&source));
  if (SUCCEEDED(hr)) hr=SHGetKnownFolderItem(FOLDERID_RecycleBinFolder, KF_FLAG_DEFAULT, nullptr, IID_PPV_ARGS(&bin));
  if (SUCCEEDED(hr)) hr=source->RecycleItem(item, bin, TSF_NORMAL, &result);
  bool ok=SUCCEEDED(hr) && result;
  if (result) result->Release();
  if (bin) bin->Release();
  if (source) source->Release();
  if (parent) parent->Release();
  if (item) item->Release();
  CoUninitialize();
  if (!ok) std::fprintf(stderr,"RecycleItem: 0x%08lx\n", static_cast<unsigned long>(hr));
  return ok ? 0 : 1;
}
