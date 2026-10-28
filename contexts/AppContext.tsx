import { createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode } from 'react';
import { usePathname,useRouter } from 'next/navigation';
import { loadLocal,saveLocal,schools,setActiveSchoolId,type Role,type School } from '@/services/school';
import { fetchSession } from '@/services/auth';
import type { Session } from '@/services/types';

type Ctx={
 role:Role;setRole:(r:Role)=>void;
 school:School;setSchool:(s:School)=>void;
 dark:boolean;toggleDark:()=>void;
 toast:(s:string)=>void;message:string;
 session:Session|null;sessionLoading:boolean;refreshSession:()=>Promise<Session|null>;
};
const Context=createContext<Ctx|null>(null);

export function AppProvider({children}:{children:ReactNode}){
 const [role,setRoleState]=useState<Role>(()=>loadLocal('campus-role','Admin'));
 const [school,setSchoolState]=useState<School>(()=>loadLocal('campus-school',schools[0]));
 const [dark,setDark]=useState(()=>loadLocal('campus-dark',false));
 const [message,setMessage]=useState('');
 const [session,setSession]=useState<Session|null>(null);
 const [sessionLoading,setSessionLoading]=useState(true);
 const router=useRouter();
 const pathname=usePathname();

  /** Re-reads /api/auth/me — after login/logout/switch and on first paint. */
  const refreshSession=useCallback(async():Promise<Session|null>=>{
    try{
      const next=await fetchSession();
      setSession(next);
      if(next){
        setActiveSchoolId(next.activeSchoolId);
        setRoleState(next.role);
        if(next.school?.name) setSchoolState(next.school);
      }
      return next;
    }catch{
      // 401/network failure is simply "signed out" for the UI.
      setSession(null);
      return null;
    }finally{
      setSessionLoading(false);
    }
  },[]);

  useEffect(()=>{void refreshSession()},[refreshSession]);

  // Session vanished while on a protected screen (expiry, sign-out elsewhere).
  const isEntry=pathname==='/auth'||pathname==='/onboarding';
  useEffect(()=>{
    if(!isEntry&&!sessionLoading&&!session) router.replace('/auth');
  },[isEntry,sessionLoading,session,router]);

 useEffect(()=>{saveLocal('campus-role',role)},[role]);useEffect(()=>{saveLocal('campus-school',school)},[school]);
  useEffect(()=>{document.documentElement.style.setProperty('--tenant-accent',school.brandColor||'#7479e8')},[school.brandColor]);
 useEffect(()=>{saveLocal('campus-dark',dark);document.documentElement.classList.toggle('dark',dark)},[dark]);
 const value=useMemo(()=>({role,setRole:(v:Role)=>setRoleState(v),school,setSchool:(v:School)=>setSchoolState(v),dark,toggleDark:()=>setDark(v=>!v),toast:(s:string)=>{setMessage(s);window.setTimeout(()=>setMessage(''),2800)},message,session,sessionLoading,refreshSession}),[role,school,dark,message,session,sessionLoading,refreshSession]);
 return <Context.Provider value={value}>{children}</Context.Provider>
}
export const useApp=()=>{const value=useContext(Context);if(!value)throw new Error('AppProvider missing');return value};
