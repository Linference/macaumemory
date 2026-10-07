const catalog = require('./catalog');
const { wgs84ToGcj02 } = require('./coordinates');
const KEY = 'macau-memory-selected-places';
Page({
  data: { places: catalog.places, counts: catalog.counts, query: '', selected: null, selectedIds: [] },
  onLoad(options) {
    const stored = wx.getStorageSync(KEY);
    const selectedIds = Array.isArray(stored) ? [...new Set(stored.filter(id => catalog.places.some(p => p.id === id)))] : [];
    this.setData({ selectedIds });
    if (options && options.id) this.selectPlace(options.id);
  },
  onSearch(e) {
    const query = e.detail.value.trim();
    this.setData({ query, places: catalog.places.filter(p => (p.name + p.categoryName).includes(query)) });
  },
  selectPlace(id) { this.setData({ selected: catalog.places.find(p => p.id === id) || null }); },
  onSelect(e) { this.selectPlace(e.currentTarget.dataset.id); },
  onClose() { this.setData({ selected: null }); },
  onPreview(e) {
    if (!this.data.selected) return;
    wx.previewImage({ current: e.currentTarget.dataset.image, urls: this.data.selected.gallery.map(p => p.image) });
  },
  onMap() {
    const p = this.data.selected;
    if (!p) return;
    const [longitude, latitude] = wgs84ToGcj02(p.coordinates);
    wx.openLocation({ longitude, latitude, name: p.name, address: p.summary, scale: 17 });
  },
  onAddPlan() {
    const p = this.data.selected;
    if (!p) return;
    const selectedIds = [...new Set([...this.data.selectedIds, p.id])];
    wx.setStorageSync(KEY, selectedIds);
    this.setData({ selectedIds });
    wx.showToast({ title: '已加入文化探索清单', icon: 'none' });
  },
  onPlan() { wx.switchTab({ url: '/pages/plan/plan' }); },
  onCopySource(e) {
    const url = e.currentTarget.dataset.url;
    if (/^https?:\/\//.test(url || '')) wx.setClipboardData({ data: url });
  },
  onShareAppMessage() {
    const p = this.data.selected;
    return { title: p ? p.name + ' · 澳门记忆' : '澳门记忆 · 文化探索',
      path: '/pages2/city-memory/city-memory' + (p ? '?id=' + encodeURIComponent(p.id) : '') };
  }
});
