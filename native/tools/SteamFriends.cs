// Read visible L4D2 presence through the installed Steam client's public ISteamClient / ISteamFriends interfaces.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;
using System.Web.Script.Serialization;

internal static class SteamFriends {
    const string Api = "steam_api64.dll";
    [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryExW(string file, IntPtr unused, uint flags);
    [DllImport("steamclient64.dll", CallingConvention=CallingConvention.Cdecl)] static extern IntPtr CreateInterface(string name, IntPtr result);
    [DllImport(Api)] static extern int SteamAPI_ISteamClient_CreateSteamPipe(IntPtr self);
    [DllImport(Api)] static extern int SteamAPI_ISteamClient_ConnectToGlobalUser(IntPtr self, int pipe);
    [DllImport(Api)] static extern void SteamAPI_ISteamClient_ReleaseUser(IntPtr self, int pipe, int user);
    [DllImport(Api)] [return:MarshalAs(UnmanagedType.I1)] static extern bool SteamAPI_ISteamClient_BReleaseSteamPipe(IntPtr self, int pipe);
    [DllImport(Api)] static extern IntPtr SteamAPI_ISteamClient_GetISteamUser(IntPtr self,int user,int pipe,string version);
    [DllImport(Api)] [return:MarshalAs(UnmanagedType.I1)] static extern bool SteamAPI_ISteamUser_BLoggedOn(IntPtr self);
    [DllImport(Api)] static extern IntPtr SteamAPI_ISteamClient_GetISteamFriends(IntPtr self,int user,int pipe,string version);
    [DllImport(Api)] static extern int SteamAPI_ISteamFriends_GetFriendCount(IntPtr self,int flags);
    [DllImport(Api)] static extern ulong SteamAPI_ISteamFriends_GetFriendByIndex(IntPtr self,int index,int flags);
    [DllImport(Api)] static extern IntPtr SteamAPI_ISteamFriends_GetFriendPersonaName(IntPtr self,ulong id);
    [DllImport(Api)] static extern IntPtr SteamAPI_ISteamClient_GetISteamUtils(IntPtr self,int pipe,string version);
    [DllImport(Api)] static extern int SteamAPI_ISteamFriends_GetSmallFriendAvatar(IntPtr self,ulong id);
    [DllImport(Api)] [return:MarshalAs(UnmanagedType.I1)] static extern bool SteamAPI_ISteamUtils_GetImageSize(IntPtr self,int handle,out uint w,out uint h);
    [DllImport(Api)] [return:MarshalAs(UnmanagedType.I1)] static extern bool SteamAPI_ISteamUtils_GetImageRGBA(IntPtr self,int handle,[Out] byte[] data,int length);
    [DllImport(Api)] [return:MarshalAs(UnmanagedType.I1)] static extern bool SteamAPI_ISteamFriends_GetFriendGamePlayed(IntPtr self,ulong id,out Game info);
    [StructLayout(LayoutKind.Sequential)] struct Game { public ulong id; public uint ip; public ushort port, query; public ulong lobby; }
    // Use only the small avatar available now. Keep room in the JSON response for every friend's presence.
    static string SmallAvatar(IntPtr friends, IntPtr utils, ulong id, ref int remaining) {
        if (utils==IntPtr.Zero || remaining<8192) return null;
        int handle=SteamAPI_ISteamFriends_GetSmallFriendAvatar(friends,id);
        uint w,h;
        if (handle<=0 || !SteamAPI_ISteamUtils_GetImageSize(utils,handle,out w,out h) || w!=32 || h!=32) return null;
        var pixels=new byte[32*32*4];
        if (!SteamAPI_ISteamUtils_GetImageRGBA(utils,handle,pixels,pixels.Length)) return null;
        using(var image=new Bitmap(32,32))
        using(var output=new MemoryStream()) {
            for(int i=0;i<1024;i++) image.SetPixel(i%32,i/32,Color.FromArgb(pixels[4*i+3],pixels[4*i],pixels[4*i+1],pixels[4*i+2]));
            image.Save(output,ImageFormat.Png);
            string data="data:image/png;base64,"+Convert.ToBase64String(output.ToArray());
            remaining-=data.Length;
            return data;
        }
    }
    static string Nickname(IntPtr p) {
        if (p == IntPtr.Zero) return "";
        int n=0; while(n<512 && Marshal.ReadByte(p,n)!=0) n++;
        var bytes=new byte[n]; Marshal.Copy(p,bytes,0,n); return Encoding.UTF8.GetString(bytes);
    }
    static int Main(string[] args) {
        // Exit codes are interpreted by the desktop service. Never write the full friends list or session material.
        if (args.Length!=1 || !Environment.Is64BitProcess) return 3;
        try {
            var root=Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam","SteamPath",null) as string;
            if (String.IsNullOrEmpty(root) || Process.GetProcessesByName("steam").Length==0) return 2;
            if (!Path.IsPathRooted(root) || !Path.IsPathRooted(args[0])) return 3;
            const uint safeSearch=0x100|0x800; // LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | SYSTEM32
            if (LoadLibraryExW(Path.Combine(root,"steamclient64.dll"),IntPtr.Zero,safeSearch)==IntPtr.Zero ||
                LoadLibraryExW(args[0],IntPtr.Zero,safeSearch)==IntPtr.Zero) return 3;
            var client=CreateInterface("SteamClient020",IntPtr.Zero);
            if (client==IntPtr.Zero) return 3;
            var pipe=SteamAPI_ISteamClient_CreateSteamPipe(client);
            if (pipe==0) return 2;
            int user=0;
            try {
                user=SteamAPI_ISteamClient_ConnectToGlobalUser(client,pipe);
                if(user==0) return 2;
                var account=SteamAPI_ISteamClient_GetISteamUser(client,user,pipe,"SteamUser023");
                if(account==IntPtr.Zero) return 3;
                if(!SteamAPI_ISteamUser_BLoggedOn(account)) return 2;
                var friends=SteamAPI_ISteamClient_GetISteamFriends(client,user,pipe,"SteamFriends017");
                if(friends==IntPtr.Zero) return 3;
                const int immediate=4;
                int count=SteamAPI_ISteamFriends_GetFriendCount(friends,immediate);
                if(count<0) return 2;
                var rows=new List<object>();
                var utils=SteamAPI_ISteamClient_GetISteamUtils(client,pipe,"SteamUtils010");
                int avatarBudget=1024*1024;
                for(int i=0;i<count;i++){
                    ulong id=SteamAPI_ISteamFriends_GetFriendByIndex(friends,i,immediate); Game g;
                    if(id==0 || !SteamAPI_ISteamFriends_GetFriendGamePlayed(friends,id,out g) || g.id!=550) continue;
                    rows.Add(new {name=Nickname(SteamAPI_ISteamFriends_GetFriendPersonaName(friends,id)),
                        avatar=SmallAvatar(friends,utils,id,ref avatarBudget),
                        ip=String.Format("{0}.{1}.{2}.{3}",g.ip>>24,(g.ip>>16)&255,(g.ip>>8)&255,g.ip&255),
                        port=g.port,query=g.query,lobby=g.lobby.ToString()});
                }
                Console.OutputEncoding=new UTF8Encoding(false);
                Console.Write(new JavaScriptSerializer().Serialize(rows)); return 0;
            } finally {
                if(user!=0) SteamAPI_ISteamClient_ReleaseUser(client,pipe,user);
                SteamAPI_ISteamClient_BReleaseSteamPipe(client,pipe);
            }
        } catch(Exception) { return 3; }
    }
}
