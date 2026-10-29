using System;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Security.Principal;

public static class ProcessingSandbox {
 [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr capabilities,uint count,out IntPtr sid);
 [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name,out IntPtr sid);
 [DllImport("userenv.dll", CharSet=CharSet.Unicode)] public static extern int DeleteAppContainerProfile(string name);
 [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int GetAppContainerFolderPath(string sid,out IntPtr path);
 [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFORMATION pi);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,IntPtr info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
 [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint exit);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint exit);
 [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint exit);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr info,int size,out int returned);
 [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr sid; public IntPtr capabilities; public uint count; public uint reserved; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO { public uint cb; public string reserved; public string desktop; public string title; public uint x,y,xsize,ysize,xchars,ychars,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO startup; public IntPtr list; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint pid,tid; }
 [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
 public sealed class ProfileInfo { public string Sid; public string Directory; }
 public sealed class Result { public uint ExitCode; public bool TimedOut; public bool AppContainer; public bool Elevated; public uint ProcessId; public uint Capabilities; public string ResourceLimit; }
 static bool DiskBudget(string directory) {
  long total=0;int count=0;var pending=new System.Collections.Generic.Stack<string>();pending.Push(directory);
  while(pending.Count>0) {
   string current=pending.Pop();
   try {
    foreach(string path in System.IO.Directory.EnumerateFileSystemEntries(current)) {
     if(++count>50000)return false;
     try {var attributes=System.IO.File.GetAttributes(path);if((attributes&System.IO.FileAttributes.ReparsePoint)!=0)return false;
      if((attributes&System.IO.FileAttributes.Directory)!=0)pending.Push(path);else {total+=new System.IO.FileInfo(path).Length;if(total>256L*1024*1024)return false;}
     }catch(System.IO.FileNotFoundException){}catch(System.IO.DirectoryNotFoundException){}
    }
   }catch(System.IO.DirectoryNotFoundException){}
  }
  return true;
 }
 static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
 static IntPtr Sid(string name) { IntPtr sid; int hr=DeriveAppContainerSidFromAppContainerName(name,out sid);Marshal.ThrowExceptionForHR(hr);return sid; }
 public static ProfileInfo Profile(string name,bool create) {
  IntPtr sid=IntPtr.Zero;
  if(create) { int hr=CreateAppContainerProfile(name,name,"DevWorkspace isolated Phase 4 file processing",IntPtr.Zero,0,out sid); if(hr==unchecked((int)0x800700B7))throw new InvalidOperationException("Existing profile has no owned sandbox state; refusing adoption"); Marshal.ThrowExceptionForHR(hr); }
  if(sid==IntPtr.Zero) sid=Sid(name);
  try { string text=new SecurityIdentifier(sid).Value;IntPtr path;Marshal.ThrowExceptionForHR(GetAppContainerFolderPath(text,out path));try{return new ProfileInfo {Sid=text,Directory=Marshal.PtrToStringUni(path)};}finally{Marshal.FreeCoTaskMem(path);} }
  finally { FreeSid(sid); }
 }
 static int TokenInt(IntPtr token,int kind) { IntPtr p=Marshal.AllocHGlobal(4);try{int size;Check(GetTokenInformation(token,kind,p,4,out size));return Marshal.ReadInt32(p);}finally{Marshal.FreeHGlobal(p);} }
 static string Quote(string value) { if(value.IndexOfAny(new char[]{'"','\r','\n','\0'})>=0 || value.EndsWith("\\"))throw new ArgumentException("Unsafe process argument");return "\""+value+"\""; }
 public static Result Run(string name,string executable,string[] args,string directory,int timeout,int memoryMiB) {
  if(timeout<100 || timeout>120000 || memoryMiB<64 || memoryMiB>2048)throw new ArgumentException("Invalid job limits");
  IntPtr sid=Sid(name),list=IntPtr.Zero,caps=IntPtr.Zero,env=IntPtr.Zero,job=IntPtr.Zero,limits=IntPtr.Zero,token=IntPtr.Zero;
  PROCESS_INFORMATION pi=new PROCESS_INFORMATION();
  try {
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);list=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(list,1,0,ref size));
   SECURITY_CAPABILITIES sc=new SECURITY_CAPABILITIES {sid=sid,count=0,capabilities=IntPtr.Zero};caps=Marshal.AllocHGlobal(Marshal.SizeOf(sc));Marshal.StructureToPtr(sc,caps,false);
   Check(UpdateProcThreadAttribute(list,0,(IntPtr)0x20009,caps,(IntPtr)Marshal.SizeOf(sc),IntPtr.Zero,IntPtr.Zero));
   string root=Environment.GetFolderPath(Environment.SpecialFolder.Windows);
   string environment="LOCALAPPDATA="+directory+"\0PATH="+System.IO.Path.GetDirectoryName(executable)+"\0SystemRoot="+root+"\0TEMP="+directory+"\0TMP="+directory+"\0WINDIR="+root+"\0\0";
   env=Marshal.StringToHGlobalUni(environment);
   STARTUPINFOEX startup=new STARTUPINFOEX();startup.startup.cb=(uint)Marshal.SizeOf(startup);startup.startup.desktop="winsta0\\default";startup.list=list;
   string command=Quote(executable);foreach(string arg in args)command+=" "+Quote(arg);
   Check(CreateProcess(executable,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x80000|0x400|0x4|0x08000000,env,directory,ref startup,out pi));
   Check(OpenProcessToken(pi.process,8,out token));
   bool appContainer=TokenInt(token,29)==1;bool elevated=TokenInt(token,20)!=0;
   int needed;GetTokenInformation(token,30,IntPtr.Zero,0,out needed);IntPtr capabilityInfo=Marshal.AllocHGlobal(needed);uint capabilityCount;
   try{Check(GetTokenInformation(token,30,capabilityInfo,needed,out needed));capabilityCount=(uint)Marshal.ReadInt32(capabilityInfo);}finally{Marshal.FreeHGlobal(capabilityInfo);}
   if(!appContainer || elevated || capabilityCount!=0)throw new InvalidOperationException("Isolation token validation failed");
   job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero);
   EXTENDED_LIMIT settings=new EXTENDED_LIMIT();settings.basic.active=1;settings.basic.processTime=60L*10000000L;settings.basic.flags=0x2000|0x100|0x200|0x8|0x2;settings.processMemory=(UIntPtr)((ulong)memoryMiB*1024*1024);settings.jobMemory=settings.processMemory;
   limits=Marshal.AllocHGlobal(Marshal.SizeOf(settings));Marshal.StructureToPtr(settings,limits,false);Check(SetInformationJobObject(job,9,limits,(uint)Marshal.SizeOf(settings)));Check(AssignProcessToJobObject(job,pi.process));
   if(ResumeThread(pi.thread)==0xffffffff)throw new Win32Exception(Marshal.GetLastWin32Error());
   bool timedOut=false;string resourceLimit=null;var clock=System.Diagnostics.Stopwatch.StartNew();
   for(;;){uint wait=WaitForSingleObject(pi.process,100);if(wait==0)break;if(wait!=258)throw new InvalidOperationException("Job wait failed");
    if(clock.ElapsedMilliseconds>=timeout){timedOut=true;resourceLimit="WALL_TIMEOUT";break;}
    try{if(!DiskBudget(directory)){resourceLimit="DISK_BUDGET";break;}}catch{resourceLimit="DISK_INSPECTION_FAILED";break;}
   }
   if(resourceLimit!=null){TerminateJobObject(job,timedOut?124U:125U);WaitForSingleObject(pi.process,5000);}
   uint exit;Check(GetExitCodeProcess(pi.process,out exit));return new Result {ExitCode=exit,TimedOut=timedOut,AppContainer=appContainer,Elevated=elevated,Capabilities=capabilityCount,ProcessId=pi.pid,ResourceLimit=resourceLimit};
  } finally {
   if(pi.process!=IntPtr.Zero){uint code;if(GetExitCodeProcess(pi.process,out code)&&code==259)TerminateProcess(pi.process,125);}
   if(token!=IntPtr.Zero)CloseHandle(token);if(job!=IntPtr.Zero)CloseHandle(job);if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);
   if(list!=IntPtr.Zero){DeleteProcThreadAttributeList(list);Marshal.FreeHGlobal(list);}if(caps!=IntPtr.Zero)Marshal.FreeHGlobal(caps);if(env!=IntPtr.Zero)Marshal.FreeHGlobal(env);if(limits!=IntPtr.Zero)Marshal.FreeHGlobal(limits);if(sid!=IntPtr.Zero)FreeSid(sid);
  }
 }
}
