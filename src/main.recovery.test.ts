// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const spies=vi.hoisted(()=>({app:vi.fn(), shared:vi.fn(), render:vi.fn(), session:vi.fn(), appLoaded:vi.fn(), sharedLoaded:vi.fn()}));
vi.mock('react-dom/client',()=>({createRoot:()=>({render:spies.render})}));
vi.mock('./App',()=>{spies.appLoaded();return {default:spies.app};});
vi.mock('./components/SharedWorkspacePage',()=>{spies.sharedLoaded();return {SharedWorkspacePage:spies.shared};});
vi.mock('./lib/release-profile',()=>({sharedWorkspaceAvailable:true}));
vi.mock('./lib/session',()=>({readSessionState:spies.session,SERVICE_TRUST_REASON:'service',BROWSER_SIGN_IN_FAILED:'failed',previewBrowserSignIn:vi.fn(),takeBrowserSignInFromLocation:vi.fn(),takePairingCodeFromLocation:vi.fn(),takeInvitedEmailFromLocation:vi.fn()}));
vi.mock('./lib/brand',()=>({bootstrapBrand:async()=>{}}));
vi.mock('./lib/skins',()=>({applySkin:vi.fn(),readSkin:vi.fn()}));
vi.mock('./lib/fonts',()=>({applyFont:vi.fn(),readFont:vi.fn()}));
vi.mock('./lib/interface-mode',()=>({settleAdvancedModeDefault:vi.fn()}));
vi.mock('./pair/BrowserSignInPage',()=>({BrowserSignInPage:vi.fn()}));
vi.mock('./pair/PairPage',()=>({PairPage:vi.fn()}));
vi.mock('./lib/crewframe-theme',()=>({}));
import { renderToStaticMarkup } from 'react-dom/server';
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();
 spies.session.mockResolvedValue({kind:'unreachable',error:'Fixture connection timed out'});
});
afterEach(()=>vi.unstubAllGlobals());
it('renders a recoverable startup connection error before any workspace mount',async()=>{
 vi.stubGlobal('location',{pathname:'/workspace',reload:vi.fn()});
 await act(async()=>{await import('./main');});
 expect(spies.render).toHaveBeenCalledTimes(2);
 expect(renderToStaticMarkup(spies.render.mock.calls[0][0])).toContain('Connecting to your workspace');
 const markup=renderToStaticMarkup(spies.render.mock.calls[1][0]);
 expect(markup).toContain('Could not connect to Chief');expect(markup).toContain('Fixture connection timed out');expect(markup).toContain('Retry connection');
 expect(spies.app).not.toHaveBeenCalled();expect(spies.shared).not.toHaveBeenCalled();
 expect(spies.appLoaded).not.toHaveBeenCalled();expect(spies.sharedLoaded).not.toHaveBeenCalled();
 const errorPage=spies.render.mock.calls[1][0].props.children;
 errorPage.props.children.props.children[2].props.onClick();
 expect(location.reload).toHaveBeenCalledOnce();
});

it('shows startup feedback while the session check is still pending',async()=>{
 let resolveSession!: (value: unknown)=>void;
 spies.session.mockImplementation(()=>new Promise(resolve=>{resolveSession=resolve;}));
 vi.stubGlobal('location',{pathname:'/',reload:vi.fn()});
 await act(async()=>{await import('./main');});
 expect(spies.render).toHaveBeenCalledOnce();
 expect(renderToStaticMarkup(spies.render.mock.calls[0][0])).toContain('Connecting to your workspace');
 expect(spies.appLoaded).not.toHaveBeenCalled();
 await act(async()=>{resolveSession({kind:'unreachable',error:'Fixture timeout'});});
 expect(spies.render).toHaveBeenCalledTimes(2);
});

it('loads the shared route without importing the personal app',async()=>{
 spies.session.mockResolvedValue({kind:'loopback',trust:'owner'});
 vi.stubGlobal('location',{pathname:'/workspace',reload:vi.fn()});
 await act(async()=>{await import('./main');});
 await vi.waitFor(()=>expect(spies.render).toHaveBeenCalledTimes(2));
 expect(spies.sharedLoaded).toHaveBeenCalledOnce();
 expect(spies.appLoaded).not.toHaveBeenCalled();
});

it('makes unexpected startup failures recoverable',async()=>{
 spies.session.mockRejectedValue(new Error('private transport detail'));
 vi.stubGlobal('location',{pathname:'/',reload:vi.fn()});
 await act(async()=>{await import('./main');});
 const markup=renderToStaticMarkup(spies.render.mock.calls.at(-1)![0]);
 expect(markup).toContain('Could not load your workspace');
 expect(markup).toContain('Retry connection');
 expect(markup).not.toContain('private transport detail');
});
