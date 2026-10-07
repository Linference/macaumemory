import test from 'node:test';
import assert from 'node:assert/strict';
import { SplatControls } from '../src/gaussian/controls.js';
const create=()=>new SplatControls({clientHeight:720,addEventListener(){}},{camera:{},setPosition(){},lookAt(){}},()=>{});
test('calibrated camera with a non-Y up axis preserves orbit distance',()=>{const c=create();c.setPose({position:[3,2,7],target:[1,2,1],up:[.3,.7,.6],fov:52});const distance=c.position.clone().sub(c.target).length();for(let i=0;i<40;i++)c.rotate(15,8);assert.ok(Math.abs(c.position.clone().sub(c.target).length()-distance)<1e-8);assert.ok(Math.abs(c.up.length()-1)<1e-8);c.destroy();});
test('zoom cannot cross the target or reach a non-finite position',()=>{const c=create();c.setPose({position:[0,0,5],target:[0,0,0]});for(let i=0;i<120;i++)c.zoom(.5);assert.ok(c.position.length()>=c.minDistance-1e-8);for(let i=0;i<120;i++)c.zoom(2);assert.ok(c.position.length()<=c.maxDistance+1e-8);assert.ok(Number.isFinite(c.position.z));c.destroy();});
test('panning moves the target and camera together without changing viewing distance',()=>{const c=create();c.setPose({position:[3,2,7],target:[1,0,1],up:[0,0,1]});const before=c.position.clone().sub(c.target);c.pan(120,-70);const after=c.position.clone().sub(c.target);assert.ok(before.clone().sub(after).length()<1e-8);c.destroy();});
