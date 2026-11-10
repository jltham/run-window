// Run Window verdict engine: pure functions shared by the page (window.RunWindowEngine)
// and the Node tests (require/import). No DOM, no network. Spec: ../docs/SPEC.md §8.
// Minutes are counted from midnight (Singapore time) of the day the data was fetched,
// so a value of 1440 or more means "tomorrow".
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RunWindowEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var AREAS=[["Ang Mo Kio",1.375,103.839],["Bedok",1.321,103.924],["Bishan",1.3508,103.839],["Boon Lay",1.304,103.701],["Bukit Batok",1.353,103.754],["Bukit Merah",1.277,103.819],["Bukit Panjang",1.362,103.772],["Bukit Timah",1.325,103.791],["Central Water Catchment",1.38,103.805],["Changi",1.357,103.987],["Choa Chu Kang",1.377,103.745],["City",1.292,103.844],["Clementi",1.315,103.76],["Geylang",1.318,103.884],["Hougang",1.3612,103.886],["Jalan Bahar",1.347,103.67],["Jurong East",1.326,103.737],["Jurong Island",1.266,103.699],["Jurong West",1.3404,103.705],["Kallang",1.312,103.862],["Lim Chu Kang",1.423,103.7173],["Mandai",1.419,103.812],["Marine Parade",1.297,103.891],["Novena",1.327,103.826],["Pasir Ris",1.37,103.948],["Paya Lebar",1.358,103.914],["Pioneer",1.315,103.675],["Pulau Tekong",1.403,104.053],["Pulau Ubin",1.404,103.96],["Punggol",1.401,103.904],["Queenstown",1.291,103.7858],["Seletar",1.404,103.869],["Sembawang",1.445,103.8185],["Sengkang",1.384,103.8914],["Sentosa",1.243,103.832],["Serangoon",1.357,103.865],["Southern Islands",1.208,103.842],["Sungei Kadut",1.413,103.756],["Tampines",1.345,103.944],["Tanglin",1.308,103.813],["Tengah",1.374,103.715],["Toa Payoh",1.3343,103.8563],["Tuas",1.2949,103.635],["Western Islands",1.2059,103.746],["Western Water Catchment",1.405,103.689],["Woodlands",1.432,103.7865],["Yishun",1.418,103.839]];
  var LEN=[45,60,90,120,180];
  var BLOCKS={wk:[[330,510],[1080,1170]],we:[[360,690],[900,1170]]};
  var TH={rain:[30,60],heat:[33,38],pm:[55,150]};
  var NAMES=["Go","Caution","No-go","Can't confirm"], ICON=["i-check","i-warn","i-stop","i-warn"];
  var FICON={storm:"i-bolt",rain:"i-drop",heat:"i-heat",pm:"i-haze"};
  var FNAME={storm:"Thunderstorm",rain:"Rain",heat:"Heat index",pm:"PM2.5"};
  var DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var STALE_MS=2*3600e3;
  // How far ahead the best-window search looks for a start time. 24 h so that an afternoon check
  // still reaches tomorrow morning's run hours (12 h only ever saw tonight's short block).
  var SEARCH_MIN=24*60;
  // Forecast hours to keep: enough for a start at +24 h plus the longest run (28 today).
  var FORECAST_HOURS=Math.ceil((SEARCH_MIN+Math.max.apply(null,LEN))/60)+1;

  // ---------- Time helpers (all in Singapore time) ----------
  function sgParts(ms){ var d=new Date(ms+8*3600e3); return {min:d.getUTCHours()*60+d.getUTCMinutes(),dow:d.getUTCDay()}; }
  function fmt(min){ var m=((min%1440)+1440)%1440, h=Math.floor(m/60), mm=m%60, h12=h%12===0?12:h%12;
    return h12+(mm?":"+String(mm).padStart(2,"0"):"")+(h<12?"am":"pm")+(Math.floor(min/1440)>0?" (tmrw)":""); }
  function fmtIso(iso){ return iso?fmt(sgParts(new Date(iso).getTime()).min):"time unknown"; }

  // ---------- Normalising API responses ----------
  function distSq(a,b){ return (a.lat-b.lat)*(a.lat-b.lat)+(a.lon-b.lon)*(a.lon-b.lon); }
  function nearest(list,p){ return list.reduce(function(b,x){ return b==null||distSq(x,p)<distSq(b,p)?x:b; },null); }
  function normalise(fetchedAt,nowcast,rain,pm25,wx,aq){
    var nc=(nowcast.data.items||[])[0]||null, ncText={};
    ((nc&&nc.forecasts)||[]).forEach(function(f){ ncText[f.area]=f.forecast; });
    var stations=(rain.data.stations||[]).filter(function(s){return s.location&&s.location.latitude!=null;})
      .map(function(s){ return {id:s.id,name:s.name,lat:s.location.latitude,lon:s.location.longitude}; });
    var reading=(rain.data.readings||[])[0]||null, rainById={};
    ((reading&&reading.data)||[]).forEach(function(d){ rainById[d.stationId]=d.value; });
    var pmItem=(pm25.data.items||[])[0]||null, pmBy=(pmItem&&pmItem.readings&&pmItem.readings.pm25_one_hourly)||{};
    var regions=(pm25.data.regionMetadata||[]).map(function(r){ return {name:r.name,lat:r.labelLocation.latitude,lon:r.labelLocation.longitude}; });
    var wxl=Array.isArray(wx)?wx:[wx], aql=Array.isArray(aq)?aq:[aq];
    var sgHour=new Date(fetchedAt.getTime()+8*3600e3).toISOString().slice(0,13)+":00";
    var i0=wxl[0].hourly.time.indexOf(sgHour);
    if (i0<0) throw new Error("forecast hours didn't line up");
    return {
      fetchedAt:fetchedAt.toISOString(), firstHour:sgHour,
      nowcast:nc?{updated:nc.update_timestamp,validFrom:nc.valid_period.start,validTo:nc.valid_period.end}:null,
      rainfallAt:reading?reading.timestamp:null, pm25At:pmItem?(pmItem.timestamp||pmItem.update_timestamp||null):null,
      areas:AREAS.map(function(a,k){
        var p={lat:a[1],lon:a[2]}, st=nearest(stations,p), reg=nearest(regions,p), h=wxl[k].hourly, pmh=aql[k].hourly.pm2_5, hours=[];
        for (var i=i0;i<i0+FORECAST_HOURS&&i<h.time.length;i++) hours.push({rp:h.precipitation_probability[i],at:h.apparent_temperature[i],code:h.weather_code[i],pm:pmh[i]==null?null:Math.round(pmh[i])});
        return {name:a[0],lat:a[1],lon:a[2],nowcast:ncText[a[0]]!=null?ncText[a[0]]:null,
          station:st?st.name:null,rainNow:st&&rainById[st.id]!=null?rainById[st.id]:null,
          pmRegion:reg?reg.name:null,pmNow:reg&&pmBy[reg.name]!=null?pmBy[reg.name]:null,hours:hours};
      })
    };
  }
  // Verdicts are worked out for the moment the data was fetched.
  function toModel(j){
    var ms=new Date(j.fetchedAt).getTime(), t=sgParts(ms), byName={};
    function old(iso){ return !iso||ms-new Date(iso).getTime()>STALE_MS; }
    var ncOld=!j.nowcast||new Date(j.nowcast.validTo).getTime()<ms, rainOld=old(j.rainfallAt), pmOld=old(j.pm25At);
    j.areas.forEach(function(a){ byName[a.name]=Object.assign({},a,{nowcast:ncOld?null:a.nowcast,rainNow:rainOld?null:a.rainNow,pmNow:pmOld?null:a.pmNow}); });
    var areas=AREAS.map(function(a){ return byName[a[0]]||{name:a[0],lat:a[1],lon:a[2],nowcast:null,rainNow:null,pmNow:null,hours:[]}; });
    var ncEnd=ncOld?t.min:t.min+Math.round((new Date(j.nowcast.validTo).getTime()-ms)/60000);
    return {dow:t.dow,now:t.min,ncEnd:ncEnd,areas:areas,meta:j,fetchedMs:ms};
  }

  // ---------- Verdict engine ----------
  function rate(v,t){ return v<=t[0]?0 : v<=t[1]?1 : 2; }
  function weekend(sc,min){ var d=(sc.dow+Math.floor(min/1440))%7; return d===0||d===6; }
  function fits(sc,s,len){ var m=s%1440, b=weekend(sc,s)?BLOCKS.we:BLOCKS.wk; return b.some(function(x){return m>=x[0]&&m+len<=x[1];}); }
  function hourOff(sc,h){ var m=(h*60)%1440, b=weekend(sc,h*60)?BLOCKS.we:BLOCKS.wk; return !b.some(function(x){return m<x[1]&&m+60>x[0];}); }
  function evaluate(sc,A,start,len,isNow){
    var ncEnd=sc.ncEnd, end=start+len, h0=Math.floor(sc.now/60), inNow=start<ncEnd;
    var rp=null, at=null, pm=null, storm=false, missing=[], warn=[];
    function mx(a,b){ return a==null?b:Math.max(a,b); }
    for (var h=Math.floor(start/60); h*60<end; h++){
      var d=A.hours[h-h0]; if(!d){ missing.push("forecast"); continue; }
      if (d.rp==null) warn.push("rain chance"); else rp=mx(rp,d.rp);
      if (d.at==null) warn.push("heat"); else at=mx(at,d.at);
      if (d.code==null) missing.push("thunderstorm forecast"); else if ([95,96,99].indexOf(d.code)>=0) storm=true;
      if (h===h0){ if (A.pmNow==null) missing.push("NEA PM2.5"); else pm=mx(pm,A.pmNow); }
      if (d.pm==null){ if (h!==h0) missing.push("PM2.5 forecast"); } else pm=mx(pm,d.pm);
    }
    if (inNow&&A.nowcast==null) missing.push("NEA nowcast");
    if (isNow&&A.rainNow==null) warn.push("rain station");
    var nct=inNow&&/thunder/i.test(A.nowcast||""), raining=isNow&&A.rainNow>0;
    var rl=rp==null?0:rate(rp,TH.rain); if (inNow&&/heavy (rain|showers)/i.test(A.nowcast||"")) rl=2; else if (inNow&&/rain|shower/i.test(A.nowcast||"")) rl=Math.max(rl,1); if (raining) rl=2;
    var f={
      storm:{l:(storm||nct)?2:0, v:nct?"NEA: thundery":storm?"Forecast":"None"},
      rain:{l:rl, v:raining?"Raining now":rp==null?"missing":rp+"%"},
      heat:{l:at==null?0:rate(at,TH.heat), v:at==null?"missing":at+" °C"},
      pm:{l:pm==null?0:rate(pm,TH.pm), v:pm==null?"missing":pm+" µg/m³"}
    };
    var keys=["storm","rain","heat","pm"], level=0;
    keys.forEach(function(k){ level=Math.max(level,f[k].l); });
    function uniq(a){ return a.filter(function(x,i){return a.indexOf(x)===i;}); }
    // Never guess Go: a missing veto input gives "Can't confirm" unless something already forces No-go.
    if (missing.length&&level<2) return {level:3,f:f,reasons:[],missing:uniq(missing),warn:[],conf:"",heat:at};
    var reasons=keys.filter(function(k){return f[k].l>0;}).sort(function(a,b){return f[b].l-f[a].l;});
    var conf=end<=ncEnd?"High confidence · NEA nowcast":(start-sc.now)<360?"Medium confidence · forecast":"Low confidence · forecast";
    return {level:level,f:f,reasons:reasons,warn:uniq(warn),conf:conf,heat:at==null?99:at};
  }
  function why(r){
    if (r.level===3) return "Can't confirm: "+r.missing.join(", ")+" data missing";
    var t=r.reasons.length ? r.reasons.slice(0,2).map(function(k){return FNAME[k]+" "+r.f[k].v;}).join(" · ") : "All conditions within your limits";
    return t+(r.warn&&r.warn.length?" · ⚠ "+r.warn.join(", ")+" data missing":"");
  }
  function best(sc,A,len){
    var first=Math.ceil(sc.now/15)*15, cands=[];
    for (var s=first; s<=sc.now+SEARCH_MIN; s+=15) if (fits(sc,s,len)) cands.push({s:s,r:evaluate(sc,A,s,len,false)});
    var fitsAny=cands.length>0, ok=cands.filter(function(c){return c.r.level<2;});
    var unknown=cands.some(function(c){return c.r.level===3;});
    cands=cands.filter(function(c){return c.r.level<3;});
    if (!ok.length) return {none:true,any:fitsAny,unknown:unknown};
    ok.sort(function(a,b){return a.r.level-b.r.level||a.s-b.s||a.r.heat-b.r.heat;});
    var p=ok[0], leave=p.s;
    if (p.r.level===0) cands.forEach(function(c){ if (c.s===leave+15&&c.r.level===0) leave=c.s; });
    return {pick:p,leave:leave};
  }
  function startAt(sc,k){ return k===0?sc.now:(Math.floor(sc.now/60)+k)*60; }
  return { AREAS: AREAS, LEN: LEN, BLOCKS: BLOCKS, TH: TH, NAMES: NAMES, ICON: ICON, FICON: FICON, FNAME: FNAME, DOW: DOW, STALE_MS: STALE_MS, SEARCH_MIN: SEARCH_MIN, FORECAST_HOURS: FORECAST_HOURS,
    sgParts: sgParts, fmt: fmt, fmtIso: fmtIso, normalise: normalise, toModel: toModel,
    rate: rate, fits: fits, hourOff: hourOff, evaluate: evaluate, why: why, best: best, startAt: startAt };
});
