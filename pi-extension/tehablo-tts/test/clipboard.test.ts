import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clipboardCommands, readClipboard} from '../src/clipboard.ts';

test('each system reads the clipboard with its own built-in tool',()=>{
  assert.deepEqual(clipboardCommands('linux',{WAYLAND_DISPLAY:'wayland-0',DISPLAY:':0'}).map(c=>c[0]),['wl-paste','xclip','xsel']);
  assert.deepEqual(clipboardCommands('linux',{DISPLAY:':0'}).map(c=>c[0]),['xclip','xsel']);
  assert.equal(clipboardCommands('win32',{})[0][0],'powershell');
  assert.match(clipboardCommands('win32',{})[0][1].join(' '),/UTF8.*Get-Clipboard -Raw/);
  assert.deepEqual(clipboardCommands('darwin',{}),[['pbpaste',[]]]);
});

test('the first tool that runs gives the text; missing tools are skipped',async()=>{
  const tried:string[]=[];
  const run=async(command:string)=>{tried.push(command);return command==='xclip'?'hola':undefined;};
  assert.equal(await readClipboard('linux',{WAYLAND_DISPLAY:'w',DISPLAY:':0'},run),'hola');
  assert.deepEqual(tried,['wl-paste','xclip']);
  assert.equal(await readClipboard('linux',{WAYLAND_DISPLAY:'w'},async()=>''),'');
});

test('without any tool it says what to install',async()=>{
  await assert.rejects(readClipboard('linux',{DISPLAY:':0'},async()=>undefined),/instala wl-clipboard o xclip/);
  await assert.rejects(readClipboard('linux',{},async()=>undefined),/SSH.*portapapeles del servidor.*no tiene/);
  assert.deepEqual(clipboardCommands('linux', {}), []);
});
