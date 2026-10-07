"""Install only the listed integration files in the two user-named projects."""
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parents[2]
MINI = Path('C:/Users/LINKIT/WeChatProjects/4645126583161307137')
SPLAT = Path('D:/Users/LINKIT/Desktop/MacauSplat')
BACKUP = ROOT / 'output/integration/backups'


def write(path, content):
    if path.exists():
        relative = path.relative_to(MINI) if path.is_relative_to(MINI) else path.relative_to(SPLAT)
        backup = BACKUP / ('mini' if path.is_relative_to(MINI) else 'splat') / relative
        if not backup.exists():
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, backup)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')


def main():
    stage = ROOT / 'output/integration/mini'
    target = MINI / 'pages2/city-memory'
    for source in stage.rglob('*'):
        if source.is_file():
            destination = target / source.relative_to(stage)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists() and not (BACKUP/'mini'/destination.relative_to(MINI)).exists():
                backup=BACKUP/'mini'/destination.relative_to(MINI)
                backup.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(destination,backup)
            shutil.copyfile(source, destination)
    for source in (ROOT / 'tools/integration/mini').glob('*'):
        write(target/source.name, source.read_text(encoding='utf-8'))
    app_path = MINI / 'app.json'
    app = json.loads(app_path.read_text(encoding='utf-8-sig'))
    package = next(p for p in app['subpackages'] if p['root'] == 'pages2')
    if 'city-memory/city-memory' not in package['pages']:
        package['pages'].append('city-memory/city-memory')
    write(app_path, json.dumps(app, ensure_ascii=False, indent=2)+'\n')
    shared = json.loads((ROOT/'public/data/system-catalog.json').read_text(encoding='utf-8'))
    shortlist = {'places': [{k:p[k] for k in ('id','name','photoCount')} for p in shared['places']]}
    write(MINI/'utils/memory-catalog.js','module.exports = '+json.dumps(shortlist,ensure_ascii=False)+';\n')
    index = MINI / 'pages/index/index.wxml'
    content=index.read_text(encoding='utf-8')
    if '/pages2/city-memory/city-memory' not in content:
        content=content.replace('<view class="container">','<view class="container"><navigator url="/pages2/city-memory/city-memory" class="card" style="padding:26rpx;background:#244d46;color:white;display:block">澳门记忆 · 实拍建筑档案与文化探索 →</navigator>',1)
    write(index,content)
    plan = MINI / 'pages/plan/plan.js'
    content=plan.read_text(encoding='utf-8')
    if 'loadMemoryPlaces' not in content:
        content=content.replace('onShow: function() {','onShow: function() {\n    this.loadMemoryPlaces();',1)
        insert="""
  loadMemoryPlaces: function() {
    const catalog = require('../../utils/memory-catalog');
    const stored = wx.getStorageSync('macau-memory-selected-places');
    const ids = Array.isArray(stored) ? stored : [];
    this.setData({ memoryPlaces: catalog.places.filter(p => ids.includes(p.id)) });
  },
  openMemoryPlace: function(e) {
    wx.navigateTo({ url: '/pages2/city-memory/city-memory?id=' + encodeURIComponent(e.currentTarget.dataset.id) });
  },
  clearMemoryPlaces: function() {
    wx.removeStorageSync('macau-memory-selected-places');
    this.setData({ memoryPlaces: [] });
  },
"""
        content=content.replace('  onLoad: function(options) {',insert+'\n  onLoad: function(options) {',1)
    content = content.replace("const ids = wx.getStorageSync('macau-memory-selected-places') || [];", "const stored = wx.getStorageSync('macau-memory-selected-places');\n    const ids = Array.isArray(stored) ? stored : [];")
    write(plan,content)
    wxml=MINI/'pages/plan/plan.wxml'
    content=wxml.read_text(encoding='utf-8')
    if 'memoryPlaces' not in content:
        card='<view wx:if="{{memoryPlaces.length}}" class="card" style="padding:24rpx"><text class="subtitle">我的文化探索清单</text><view wx:for="{{memoryPlaces}}" wx:key="id" data-id="{{item.id}}" bindtap="openMemoryPlace" style="padding:18rpx 0">{{item.name}} · {{item.photoCount}} 张实拍 →</view><button bindtap="clearMemoryPlaces">清空探索清单</button></view>'
        content=content.replace('<view class="container">','<view class="container">'+card,1)
    write(wxml,content)
    # The CLI companion leaves the existing reconstruction/export commands intact.
    write(SPLAT/'scripts/memory-bridge.py',(ROOT/'tools/integration/annotation_bridge.py').read_text(encoding='utf-8'))
    write(SPLAT/'scripts/annotation-review.html',(ROOT/'tools/integration/annotation-review.html').read_text(encoding='utf-8'))
    write(SPLAT/'docs/MEMORY-INTEGRATION.md',(ROOT/'docs/system-integration.md').read_text(encoding='utf-8'))
    print('Installed: native memory page, homepage entry, planner shortlist, MacauSplat review companion. Backups saved.')


if __name__=='__main__':main()
