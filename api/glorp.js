// api/glorpcat.js — fetch-only, streams image/* bytes
// Env: SERPAPI_KEY (optional; falls back to static meme links if missing)

export const config = { api: { bodyParser: false } };

// Be gentle here—memes live on lots of hosts; only block the worst offenders
const BLOCK_SITES = [
  "pinterest.", "etsy.", "redbubble.", "aliexpress.", "temu.",
  "vectorstock.", "shutterstock.", "adobe.", "istockphoto.", "123rf.",
  "dreamstime.", "depositphotos.", "freepik.", "pngtree."
];

// keep only truly noisy terms out; memes may say “meme”, so don’t block it
const BLOCK_WORDS = [
  "logo","watermark","stock photo", "shirt", "merch"
];

const QUERIES = [
  "glorp",
  "glorp cat",
  "glorp meme"
];

// Static fallbacks (try to use direct image links)
const FALLBACKS = [
  // add any of your own direct-image URLs here too
  "https://media.tenor.com/4Od0NUWfA54AAAAe/glorp.png",
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRxQkOG_QEpYsJua6QOTk0AYVUCSnR1LDDrJA&s",
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR69z01TDwMjp_zoc-sYW0gpEPVTYI-c96vBQ&s"
];

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function setCORS(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}
function setCache(res){
  res.setHeader("Cache-Control","public, s-maxage=3600, stale-while-revalidate=43200");
}
function blockedSite(url){
  try{
    const h = new URL(url).hostname.toLowerCase();
    return BLOCK_SITES.some(d => h.includes(d));
  }catch{
    // don’t nuke on parse failure (memes often have odd URLs)
    return false;
  }
}
function blockedWords(text=""){
  const s = String(text).toLowerCase();
  return BLOCK_WORDS.some(w => s.includes(w));
}
async function fetchJSON(url){
  const r = await fetch(url, { redirect:"follow", headers:{ "user-agent":"Mozilla/5.0" } });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchAsImage(url){
  const r = await fetch(url, {
    redirect:"follow",
    headers: { "user-agent":"Mozilla/5.0", "accept":"image/*,*/*;q=0.8" }
  });
  if(!r.ok) return null;
  const ct = (r.headers.get("content-type")||"").toLowerCase();
  if(!ct.startsWith("image/")) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  let ext = "jpg";
  if (ct.includes("png")) ext = "png";
  else if (ct.includes("jpeg")) ext = "jpg";
  else if (ct.includes("gif")) ext = "gif";
  else if (ct.includes("webp")) ext = "webp";
  return { buf, ct, ext };
}

export default async function handler(req,res){
  setCORS(res);
  if(req.method==="OPTIONS") return res.status(204).end();

  const serpKey = process.env.SERPAPI_KEY;
  const userQ = (req.query.q||"").toString().trim();
  const baseQuery = userQ || pick(QUERIES);
  const debug = ((req.query.format||"").toString().toLowerCase()==="json");

  // no key -> use static meme fallbacks
  if(!serpKey){
    setCache(res);
    const url = pick(FALLBACKS);
    const data = await fetchAsImage(url);
    if(!data) return res.status(500).json({ ok:false, error:"no_key_and_fallback_failed" });

    if(debug) return res.status(200).json({ ok:true, source:"static_fallback", image:url, content_type:data.ct });
    res.setHeader("Content-Type", data.ct);
    res.setHeader("Content-Disposition", `inline; filename="glorpcat.${data.ext}"`);
    return res.status(200).send(data.buf);
  }

  // Random page 0..5; NO tbs=photo (memes aren't "photos")
  const ijn = Math.floor(Math.random()*6);
  const params = new URLSearchParams({
    engine:"google_images",
    q: `${baseQuery} -plush -toy -merch -vector`,
    tbm:"isch",
    safe:"active",
    ijn:String(ijn),
    api_key:serpKey
  });

  let candidates = [];
  try{
    const data = await fetchJSON(`https://serpapi.com/search.json?${params.toString()}`);
    const list = Array.isArray(data.images_results) ? data.images_results : [];
    candidates = list.filter(r=>{
      const url = r?.original || r?.thumbnail || "";
      const title = r?.title || "";
      if(!url) return false;
      if(url.toLowerCase().endsWith(".svg")) return false;
      if(blockedSite(url)) return false;
      if(blockedWords(title)) return false;
      return true;
    });
  }catch{
    // fall through
  }

  // shuffle
  for(let i=candidates.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [candidates[i],candidates[j]]=[candidates[j],candidates[i]];
  }

  setCache(res);

  // try up to 12 candidates; try original then thumbnail
  const MAX_TRIES = Math.min(12, candidates.length);
  for(let i=0;i<MAX_TRIES;i++){
    const c = candidates[i];
    for (const u of [c?.original, c?.thumbnail]) {
      if(!u) continue;
      const data = await fetchAsImage(u);
      if(!data) continue;

      if(debug){
        return res.status(200).json({
          ok:true, source:"serpapi", image:u, content_type:data.ct, candidates:candidates.length
        });
      }
      res.setHeader("Content-Type", data.ct);
      res.setHeader("Content-Disposition", `inline; filename="glorpcat.${data.ext}"`);
      return res.status(200).send(data.buf);
    }
  }

  // fallback bytes
  const url = pick(FALLBACKS);
  const data = await fetchAsImage(url);
  if(!data) return res.status(404).json({ ok:false, error:"no_usable_glorpcat_found", candidates:candidates.length });
  res.setHeader("Content-Type", data.ct);
  res.setHeader("Content-Disposition", `inline; filename="glorpcat.${data.ext}"`);
  return res.status(200).send(data.buf);
}
