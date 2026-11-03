import { Popup } from 'maplibre-gl';
export function installCommunityMemory(map, checkbox) {
  let ready = false, pending = false;
  const sync = () => { if (ready) map.setLayoutProperty('community-memory-points', 'visibility', checkbox.checked ? 'visible' : 'none'); };
  async function refresh() {
    if (pending || !map.isStyleLoaded()) return; pending = true;
    try {
      const response = await fetch('/api/memory/map'); if (!response.ok) return;
      const data = await response.json(); if (data.type !== 'FeatureCollection') return;
      if (!ready) {
        map.addSource('community-memory', { type: 'geojson', data });
        map.addLayer({ id: 'community-memory-points', type: 'circle', source: 'community-memory', paint: { 'circle-radius': 7, 'circle-color': '#d8b45a', 'circle-stroke-color': '#203642', 'circle-stroke-width': 3 } });
        map.on('click', 'community-memory-points', e => {
          const feature = e.features?.[0]; if (!feature) return;
          const body = document.createElement('div'), title = document.createElement('strong'), note = document.createElement('p'), link = document.createElement('a');
          title.textContent = feature.properties.name; note.textContent = `${feature.properties.memoryId || '地點記憶'} · ${feature.properties.stories} 則可讀取記憶`;
          link.textContent = '閱讀故事 · 留下我的記憶'; link.href = './memory.html?place=' + encodeURIComponent(feature.properties.id); body.append(title, note, link);
          new Popup().setLngLat(feature.geometry.coordinates).setDOMContent(body).addTo(map);
        });
        map.on('mouseenter','community-memory-points',()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave','community-memory-points',()=>{map.getCanvas().style.cursor='';});ready = true;
      } else map.getSource('community-memory').setData(data);
      sync();
    } catch { /* Optional local service; existing map remains usable. */ } finally { pending = false; }
  }
  map.on('load', refresh); window.addEventListener('focus', refresh); checkbox.addEventListener('change', sync);
  if (map.isStyleLoaded()) refresh();
}
