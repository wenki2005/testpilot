import {useEffect,useState} from 'react';

// Presentation events reuse the workbench's existing system-selection state.
export type SidebarProjects={systems:Array<{id:string;name:string}>;systemId:string;disabled:boolean};
export const sidebarProjectEvents={state:'testpilot:sidebar-project-state',request:'testpilot:sidebar-project-request',select:'testpilot:sidebar-project-select'};
export function useSidebarProjects(){
 const [projects,setProjects]=useState<SidebarProjects>();
 useEffect(()=>{const listener=(event:Event)=>{const next=(event as CustomEvent<SidebarProjects>).detail;setProjects(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);};window.addEventListener(sidebarProjectEvents.state,listener);window.dispatchEvent(new Event(sidebarProjectEvents.request));return()=>window.removeEventListener(sidebarProjectEvents.state,listener);},[]);
 return projects;
}
export function selectSidebarProject(systemId:string){window.dispatchEvent(new CustomEvent(sidebarProjectEvents.select,{detail:systemId}));}
