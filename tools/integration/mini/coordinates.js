// The shared catalog is WGS84; WeChat's native map uses GCJ02.
function wgs84ToGcj02([lng, lat]) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('Invalid location');
  if (lng < 72.004 || lng > 137.8347 || lat < .8293 || lat > 55.8271) return [lng, lat];
  const x=lng-105,y=lat-35,pi=Math.PI;
  let dlat=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
  dlat+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dlat+=(20*Math.sin(y*pi)+40*Math.sin(y/3*pi))*2/3;
  dlat+=(160*Math.sin(y/12*pi)+320*Math.sin(y*pi/30))*2/3;
  let dlng=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  dlng+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dlng+=(20*Math.sin(x*pi)+40*Math.sin(x/3*pi))*2/3;
  dlng+=(150*Math.sin(x/12*pi)+300*Math.sin(x/30*pi))*2/3;
  const rad=lat/180*pi,magic=1-.00669342162296594323*Math.sin(rad)**2,sqrt=Math.sqrt(magic),a=6378245;
  return [lng+dlng/(a/sqrt*Math.cos(rad)*pi)*180,lat+dlat/(a*(1-.00669342162296594323)/(magic*sqrt)*pi)*180];
}
module.exports = { wgs84ToGcj02 };
