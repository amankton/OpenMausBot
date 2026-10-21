// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/state/store', () => ({ api: vi.fn() }));
vi.mock('./ChiefConnectionsHost', () => ({ ChiefConnectionsHost: () => null }));
vi.mock('./ChiefPairingPanel', () => ({ ChiefPairingPanel: () => null }));
import { SharedWorkspaceSurface } from './SharedWorkspacePage';
import { WORKSPACE_HELLO, WORKSPACE_SLOT } from '../lib/workspace-shell';
let root: Root | undefined;
let host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); host=document.createElement('div');document.body.append(host); });
afterEach(async () => { if(root) await act(async()=>root!.unmount());root=undefined;vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren(); });

it('rechecks without replacing a frame; explicit reload replaces once and preserves boundaries',async()=>{
 const windows=new WeakMap<HTMLIFrameElement, Window>();
 vi.spyOn(HTMLIFrameElement.prototype,'contentWindow','get').mockImplementation(function(this:HTMLIFrameElement){if(!windows.has(this)) windows.set(this,{postMessage:vi.fn()} as unknown as Window);return windows.get(this)!;});
 const onRetry=vi.fn();const props={status:{enabled:true,available:true,name:'Chief shared workspace' as const,url:'http://localhost:18087/'},error:'',loading:false,origin:'http://127.0.0.1:5299',onRetry};
 root=createRoot(host);await act(async()=>root!.render(createElement(SharedWorkspaceSurface,props)));
 const original=host.querySelector('iframe')!;const oldWindow=original.contentWindow;const attributes=['src','sandbox','allow','referrerpolicy'].map(k=>original.getAttribute(k));
 await act(async()=>{Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Retry connection')!.click();});
 await act(async()=>root!.render(createElement(SharedWorkspaceSurface,{...props,loading:true})));
 expect(onRetry).toHaveBeenCalledOnce();expect(host.querySelector('iframe')).toBe(original);
 await act(async()=>{Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Reload workspace')!.click();});
 const replacement=host.querySelector('iframe')!;expect(replacement).not.toBe(original);expect(attributes).toEqual(['src','sandbox','allow','referrerpolicy'].map(k=>replacement.getAttribute(k)));
 const post=vi.spyOn(replacement.contentWindow!,'postMessage');
 await act(async()=>replacement.dispatchEvent(new Event('load')));
 expect(post).toHaveBeenCalledWith({type:WORKSPACE_HELLO},'http://localhost:18087');
 expect(post).toHaveBeenCalledWith(expect.objectContaining({type:'crewframe:theme'}),'http://localhost:18087');
 await act(async()=>window.dispatchEvent(new MessageEvent('message',{source:oldWindow,origin:'http://localhost:18087',data:{type:WORKSPACE_SLOT,rect:{x:10,y:10,width:120,height:40}}})));
 expect(host.querySelector('header')!.style.left).toBe('');
 await act(async()=>window.dispatchEvent(new MessageEvent('message',{source:replacement.contentWindow,origin:'http://localhost:18087',data:{type:WORKSPACE_SLOT,rect:{x:10,y:10,width:120,height:40}}})));
 expect(host.querySelector('header')!.style.left).toBe('10px');expect(host.querySelector('iframe')).toBe(replacement);
});
