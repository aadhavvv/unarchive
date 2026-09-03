import { useState, useRef, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Auth from './Auth'
import './App.css'

const CATS = ["All","Tops","Bottoms","Dresses","Shoes","Accessories"]
const EMOJIS = { Tops:"🧥", Bottoms:"👖", Dresses:"👗", Shoes:"👟", Accessories:"👜" }
const SUGGEST = (item) => Math.round((item.bought_price||0) * (item.condition==="Like new"?0.65:item.condition==="Excellent"?0.5:0.35))
const BUCKET = "clothing-clicks"

// Resize + compress an image client-side before sending it anywhere.
// Phone photos are often 3-8MB; base64-encoded that can exceed serverless
// request size limits and get silently rejected before your function ever runs.
// This keeps the payload small and reliable.
function compressImage(file, maxDim = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()
    reader.onload = () => { img.src = reader.result }
    reader.onerror = reject
    img.onload = () => {
      let { width, height } = img
      if (width > height && width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim }
      else if (height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Compression failed'))
          const outReader = new FileReader()
          outReader.onload = () => resolve({ base64: outReader.result.split(',')[1], blob, mimeType: 'image/jpeg' })
          outReader.onerror = reject
          outReader.readAsDataURL(blob)
        },
        'image/jpeg',
        quality
      )
    }
    img.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function App() {
  const [session, setSession] = useState(null)
  const [tab, setTab] = useState("wardrobe")
  const [items, setItems] = useState([])
  const [marketItems, setMarketItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [marketSelected, setMarketSelected] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [listPrice, setListPrice] = useState("")
  const [catFilter, setCatFilter] = useState("All")
  const [mktFilter, setMktFilter] = useState("All")
  const [mktSearch, setMktSearch] = useState("")
  const [toast, setToast] = useState("")
  const [toastOn, setToastOn] = useState(false)
  const [form, setForm] = useState({ name:"", brand:"", category:"Tops", condition:"Good", bought_price:"", size:"" })
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [profileStats, setProfileStats] = useState({ total:0, value:0, earned:0, wears:0 })
  const [tagging, setTagging] = useState(false)
  const [tagError, setTagError] = useState("")
  const [estimatedResale, setEstimatedResale] = useState(null)
  const [stylistOutfits, setStylistOutfits] = useState([])
  const [stylistLoading, setStylistLoading] = useState(false)
  const [stylistError, setStylistError] = useState("")
  const timer = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    supabase.auth.onAuthStateChange((_event, session) => setSession(session))
  }, [])

  useEffect(() => { if (session) { fetchItems(); fetchMarket() } }, [session])

  if (!session) return <Auth />

  async function fetchItems() {
    setLoading(true)
    const { data, error } = await supabase.from('items').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false })
    if (!error) {
      const mapped = data.map(i => ({ ...i, emoji: EMOJIS[i.category]||"👕" }))
      setItems(mapped)
      setProfileStats({
        total: mapped.length,
        value: mapped.reduce((s,i)=>s+(i.bought_price||0),0),
        earned: mapped.filter(i=>i.status==='sold').reduce((s,i)=>s+(i.listed_price||0),0),
        wears: mapped.reduce((s,i)=>s+(i.wears||0),0),
      })
    }
    setLoading(false)
  }

  async function fetchMarket() {
    const { data, error } = await supabase.from('items').select('*').eq('status', 'listed').order('created_at', { ascending: false })
    if (!error) setMarketItems(data.map(i => ({ ...i, emoji: EMOJIS[i.category]||"👕" })))
  }

  function showToast(msg) {
    setToast(msg); setToastOn(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToastOn(false), 2200)
  }

  async function handlePhotoSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    setTagError(""); setEstimatedResale(null); setTagging(true)
    try {
      const { base64, blob, mimeType } = await compressImage(file)
      setPhotoBlob(blob)
      setPhotoPreview(URL.createObjectURL(blob))

      const res = await fetch('/api/tag-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType }),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        console.error('tag-item request failed', res.status, errBody)
        throw new Error(`Tagging failed (${res.status})`)
      }
      const tags = await res.json()
      setForm(p => ({
        ...p,
        name: tags.name || p.name,
        brand: tags.brand || p.brand,
        category: tags.category || p.category,
        condition: tags.condition || p.condition,
      }))
      if (tags.estimated_resale_value) setEstimatedResale(tags.estimated_resale_value)
    } catch (err) {
      console.error('Auto-tag error:', err)
      setTagError("Auto-tag failed — fill in manually")
    } finally {
      setTagging(false)
    }
  }

  async function addItem() {
    if (!form.name || !form.brand) return
    setUploading(true)
    let image_url = null
    if (photoBlob) {
      const fileName = `${session.user.id}_${Date.now()}.jpg`
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(fileName, photoBlob, { contentType: 'image/jpeg' })
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
        image_url = urlData.publicUrl
      } else {
        console.error('Image upload failed', uploadError)
      }
    }
    const { data, error } = await supabase.from('items').insert([{
      name: form.name, brand: form.brand, category: form.category,
      condition: form.condition, bought_price: parseFloat(form.bought_price)||0,
      wears: 0, status: 'wardrobe', image_url, user_id: session.user.id,
      size: form.size,
      estimated_resale_value: estimatedResale,
    }]).select()
    setUploading(false)
    if (!error) {
      setItems(p => [{ ...data[0], emoji: EMOJIS[data[0].category] }, ...p])
      setAddOpen(false)
      setForm({ name:"", brand:"", category:"Tops", condition:"Good", bought_price:"", size:"" })
      setPhotoBlob(null); setPhotoPreview(null); setEstimatedResale(null); setTagError("")
      showToast("Added to wardrobe ✓")
    } else {
      console.error('Insert failed', error)
      showToast("Something went wrong")
    }
  }

  async function deleteItem(id) {
    const { error } = await supabase.from('items').delete().eq('id', id)
    if (!error) {
      setItems(p => p.filter(i => i.id !== id))
      setSelected(null); setDeleteConfirm(null)
      showToast("Deleted")
    }
  }

  async function listItem() {
    const price = parseFloat(listPrice)
    if (!price) return
    const { error } = await supabase.from('items').update({ status:'listed', listed_price:price }).eq('id', selected.id)
    if (!error) {
      setItems(p => p.map(i => i.id===selected.id ? {...i, status:"listed", listed_price:price} : i))
      setListOpen(false); setSelected(null)
      fetchMarket()
      showToast("Listed for sale ✓")
    }
  }

  async function logWear(id) {
    const item = items.find(i => i.id===id)
    const { error } = await supabase.from('items').update({ wears: item.wears+1 }).eq('id', id)
    if (!error) { setItems(p => p.map(i => i.id===id ? {...i, wears:i.wears+1} : i)); showToast("Wear logged ✓") }
  }

  async function unlist(id) {
    const { error } = await supabase.from('items').update({ status:'wardrobe', listed_price:null }).eq('id', id)
    if (!error) {
      setItems(p => p.map(i => i.id===id ? {...i, status:"wardrobe", listed_price:null} : i))
      setSelected(null); fetchMarket(); showToast("Unlisted")
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null); setItems([])
  }

  async function generateOutfits() {
    const wardrobeOnly = items.filter(i => i.status !== 'listed')
    if (wardrobeOnly.length < 2) {
      setStylistError("Add at least 2 items to your wardrobe first")
      return
    }
    setStylistLoading(true); setStylistError(""); setStylistOutfits([])
    try {
      const res = await fetch('/api/stylist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: wardrobeOnly.map(i => ({ id: i.id, name: i.name, brand: i.brand, category: i.category, condition: i.condition })) }),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        console.error('stylist request failed', res.status, errBody)
        throw new Error(`Stylist failed (${res.status})`)
      }
      const data = await res.json()
      if (!data.outfits || data.outfits.length === 0) {
        setStylistError("Couldn't put together outfits from what's in your wardrobe yet")
      } else {
        setStylistOutfits(data.outfits)
      }
    } catch (err) {
      console.error('Stylist error:', err)
      setStylistError("Something went wrong — try again")
    } finally {
      setStylistLoading(false)
    }
  }

  const wardrobeItems = items.filter(i => catFilter==="All" || i.category===catFilter)
  const listedItems = items.filter(i => i.status==="listed")
  const filteredMarket = marketItems.filter(i => {
    const matchCat = mktFilter==="All" || i.category===mktFilter
    const matchSearch = !mktSearch || i.name.toLowerCase().includes(mktSearch.toLowerCase()) || i.brand.toLowerCase().includes(mktSearch.toLowerCase())
    return matchCat && matchSearch
  })

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">un<span>archive</span></div>
        <button onClick={signOut} className="signout-btn">Sign out</button>
      </div>

      {/* WARDROBE */}
      {tab==="wardrobe" && !selected && (
        <div className="screen">
          <div className="hero-line">Your wardrobe, catalogued.<br/>The way it should have always worked.</div>
          <div className="stats-row">
            <div className="stat"><div className="stat-val">{items.length}</div><div className="stat-lbl">Items</div></div>
            <div className="stat"><div className="stat-val">€{items.reduce((s,i)=>s+(i.bought_price||0),0)}</div><div className="stat-lbl">Value</div></div>
            <div className="stat"><div className="stat-val">{listedItems.length}</div><div className="stat-lbl">Listed</div></div>
          </div>
          <button className="add-btn" onClick={()=>setAddOpen(true)}>+ Add Item</button>
          <div className="section-lbl">My Wardrobe</div>
          <div className="chips">
            {CATS.map(c=><button key={c} className={"chip"+(catFilter===c?" chip-on":"")} onClick={()=>setCatFilter(c)}>{c}</button>)}
          </div>
          {loading ? (
              <div className="skeleton-grid">
                {[0,1,2,3].map(i=>(
                  <div key={i} className="skeleton-card">
                    <div className="skeleton-img"></div>
                    <div className="skeleton-line"></div>
                    <div className="skeleton-line short"></div>
                  </div>
                ))}
              </div>
            )
            : wardrobeItems.length===0 ? <div className="empty">Your wardrobe is empty.<br/>Add your first piece.</div>
            : <div className="grid">
                {wardrobeItems.map((item,idx)=>(
                  <div key={item.id} className="item-card fade-up" style={{animationDelay:`${idx*0.03}s`}} onClick={()=>setSelected(item)}>
                    <div className="item-img">
                      {item.image_url ? <img src={item.image_url} alt={item.name} className="img-fade" onLoad={e=>e.target.classList.add('loaded')} style={{width:"100%",height:"100%",objectFit:"cover"}} /> : item.emoji}
                    </div>
                    <div className="item-body">
                      <div className="item-name">{item.name}</div>
                      <div className="item-brand">{item.brand}</div>
                      <div className="item-foot">
                        {item.status==="listed" ? <span className="badge badge-green">Listed</span> : <span className="badge badge-purple">{item.wears}×</span>}
                        <span className="item-price">€{item.bought_price}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>}
        </div>
      )}

      {/* ITEM DETAIL */}
      {tab==="wardrobe" && selected && (
        <div className="screen">
          <button className="back-btn" onClick={()=>setSelected(null)}>← Back</button>
          <div className="detail-img">
            {selected.image_url ? <img src={selected.image_url} alt={selected.name} className="img-fade" onLoad={e=>e.target.classList.add('loaded')} style={{width:"100%",height:"100%",objectFit:"cover"}} /> : selected.emoji}
          </div>
          <div className="detail-name">{selected.name}</div>
          <div className="detail-meta">{selected.brand} — {selected.category} — {selected.condition}{selected.size ? ` — ${selected.size}` : ''}</div>
          <div className="cpw-row">
            <span className="cpw-lbl">Cost per wear</span>
            <span className="cpw-val">€{selected.wears>0?(selected.bought_price/selected.wears).toFixed(2):selected.bought_price}</span>
          </div>
          <div className="detail-actions">
            {selected.status!=="listed"
              ? <button className="btn-primary" onClick={()=>{setListPrice(String(SUGGEST(selected)));setListOpen(true)}}>Sell This Piece</button>
              : <button className="btn-secondary" onClick={()=>unlist(selected.id)}>Remove Listing — €{selected.listed_price}</button>}
            <button className="btn-secondary" onClick={()=>logWear(selected.id)}>Log a Wear</button>
            <button className="btn-delete" onClick={()=>setDeleteConfirm(selected.id)}>Delete Item</button>
          </div>
        </div>
      )}

      {/* SELL */}
      {tab==="sell" && (
        <div className="screen">
          <div className="stats-row">
            <div className="stat"><div className="stat-val">{listedItems.length}</div><div className="stat-lbl">Active</div></div>
            <div className="stat"><div className="stat-val">€{listedItems.reduce((s,i)=>s+(i.listed_price||0),0)}</div><div className="stat-lbl">Listed</div></div>
            <div className="stat"><div className="stat-val">€0</div><div className="stat-lbl">Earned</div></div>
          </div>
          <div className="section-lbl">Your Listings</div>
          {listedItems.length===0
            ? <div className="empty">No active listings.<br/>Go to your wardrobe to sell a piece.</div>
            : listedItems.map(item=>(
              <div key={item.id} className="list-row" onClick={()=>{setTab("wardrobe");setSelected(item)}}>
                <div className="list-thumb">{item.image_url ? <img src={item.image_url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : item.emoji}</div>
                <div className="list-info">
                  <div className="list-name">{item.name}</div>
                  <div className="list-meta">{item.brand} — {item.condition}</div>
                </div>
                <div className="list-price">€{item.listed_price}</div>
              </div>
            ))}
        </div>
      )}

      {/* STYLIST */}
      {tab==="stylist" && (
        <div className="screen">
          <div className="hero-line">Outfits, from what you already own.<br/>No new purchases required.</div>
          <button className="add-btn" onClick={generateOutfits} disabled={stylistLoading}>
            {stylistLoading ? "Thinking..." : "Generate Outfit Ideas"}
          </button>
          {stylistError && <div className="tag-error" style={{marginBottom:20}}>{stylistError}</div>}
          {stylistLoading && (
            <div className="skeleton-grid" style={{gridTemplateColumns:"1fr"}}>
              {[0,1].map(i=>(
                <div key={i} className="skeleton-card" style={{marginBottom:1}}>
                  <div className="skeleton-line" style={{height:14}}></div>
                  <div className="skeleton-line short"></div>
                </div>
              ))}
            </div>
          )}
          {!stylistLoading && stylistOutfits.length > 0 && (
            <div>
              <div className="section-lbl">{stylistOutfits.length} Outfit{stylistOutfits.length>1?'s':''}</div>
              {stylistOutfits.map((outfit, idx) => {
                const outfitItems = outfit.item_ids.map(id => items.find(i => String(i.id)===String(id))).filter(Boolean)
                return (
                  <div key={idx} className="fade-up" style={{animationDelay:`${idx*0.06}s`, marginBottom:28}}>
                    <div style={{fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:19, color:"var(--fg)", marginBottom:4}}>{outfit.title}</div>
                    <div style={{fontSize:12, color:"var(--fg-dim)", fontStyle:"italic", marginBottom:12}}>{outfit.why}</div>
                    <div style={{display:"flex", gap:1, background:"var(--line)"}}>
                      {outfitItems.map(item => (
                        <div key={item.id} className="item-card" style={{flex:1}} onClick={()=>{setTab("wardrobe"); setSelected(item)}}>
                          <div className="item-img" style={{aspectRatio:"1/1"}}>
                            {item.image_url ? <img src={item.image_url} alt={item.name} className="img-fade" onLoad={e=>e.target.classList.add('loaded')} style={{width:"100%",height:"100%",objectFit:"cover"}} /> : item.emoji}
                          </div>
                          <div className="item-body" style={{padding:"9px 8px"}}>
                            <div className="item-name" style={{fontSize:11}}>{item.name}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {!stylistLoading && stylistOutfits.length === 0 && !stylistError && (
            <div className="empty">Tap the button above.<br/>Outfits are built from your real wardrobe.</div>
          )}
        </div>
      )}

      {/* MARKET */}
      {tab==="market" && !marketSelected && (
        <div className="screen">
          <div className="hero-line">In someone else's closet next.<br/>Secondhand, reimagined.</div>
          <div className="field" style={{marginBottom:14}}>
            <input
              value={mktSearch}
              onChange={e=>setMktSearch(e.target.value)}
              placeholder="Search brand or item..."
            />
          </div>
          <div className="chips">
            {CATS.map(c=><button key={c} className={"chip"+(mktFilter===c?" chip-on":"")} onClick={()=>setMktFilter(c)}>{c}</button>)}
          </div>
          <div className="section-lbl">{filteredMarket.length} listings</div>
          {filteredMarket.length===0
            ? <div className="empty">No listings yet.<br/>Be the first to sell something.</div>
            : filteredMarket.map(item=>(
              <div key={item.id} className="list-row" onClick={()=>setMarketSelected(item)}>
                <div className="list-thumb">
                  {item.image_url ? <img src={item.image_url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : item.emoji}
                </div>
                <div className="list-info">
                  <div className="list-name">{item.name}</div>
                  <div className="list-meta">{item.brand} — {item.condition}{item.size ? ` — ${item.size}` : ''}</div>
                </div>
                <div className="list-price">€{item.listed_price}</div>
              </div>
            ))}
        </div>
      )}

      {/* MARKET ITEM DETAIL */}
      {tab==="market" && marketSelected && (
        <div className="screen">
          <button className="back-btn" onClick={()=>setMarketSelected(null)}>← Back</button>
          <div className="detail-img">
            {marketSelected.image_url ? <img src={marketSelected.image_url} alt={marketSelected.name} className="img-fade" onLoad={e=>e.target.classList.add('loaded')} style={{width:"100%",height:"100%",objectFit:"cover"}} /> : marketSelected.emoji}
          </div>
          <div className="detail-name">{marketSelected.name}</div>
          <div className="detail-meta">{marketSelected.brand} — {marketSelected.category} — {marketSelected.condition}{marketSelected.size ? ` — Size ${marketSelected.size}` : ''}</div>
          <div className="cpw-row">
            <span className="cpw-lbl">Asking price</span>
            <span className="cpw-val">€{marketSelected.listed_price}</span>
          </div>
          <div className="detail-actions">
            <button className="btn-primary" onClick={()=>showToast("Message seller — coming soon")}>Contact Seller</button>
          </div>
        </div>
      )}

      {/* PROFILE */}
      {tab==="profile" && (
        <div className="screen">
          <div style={{textAlign:'center',marginBottom:26}}>
            <div style={{width:64,height:64,borderRadius:'50%',background:'var(--bg-raised)',border:'0.5px solid var(--line)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px',fontSize:24}}>👤</div>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:12,color:'var(--fg-dim)',letterSpacing:2}}>{session.user.email}</div>
          </div>
          <div className="stats-row">
            <div className="stat"><div className="stat-val">{profileStats.total}</div><div className="stat-lbl">Items</div></div>
            <div className="stat"><div className="stat-val">€{profileStats.value}</div><div className="stat-lbl">Wardrobe value</div></div>
            <div className="stat"><div className="stat-val">{profileStats.wears}</div><div className="stat-lbl">Total wears</div></div>
          </div>
          <div className="section-lbl" style={{marginTop:22}}>Account</div>
          <div className="list-row">
            <div className="list-info"><div className="list-name">Email</div><div className="list-meta">{session.user.email}</div></div>
          </div>
          <div className="list-row">
            <div className="list-info"><div className="list-name">Member since</div><div className="list-meta">{new Date(session.user.created_at).toLocaleDateString('en-GB', {month:'long',year:'numeric'})}</div></div>
          </div>
          <div style={{marginTop:26}}>
            <button className="btn-delete" onClick={signOut}>Sign Out</button>
          </div>
        </div>
      )}

      {/* BOTTOM NAV */}
      <div className="bottom-nav">
        <button className={"bnav"+(tab==="wardrobe"?" bnav-on":"")} onClick={()=>{setTab("wardrobe");setSelected(null)}}>
          <span className="bnav-icon">👗</span><span>Wardrobe</span>
        </button>
        <button className={"bnav"+(tab==="sell"?" bnav-on":"")} onClick={()=>setTab("sell")}>
          <span className="bnav-icon">◇</span><span>Sell</span>
        </button>
        <button className={"bnav"+(tab==="stylist"?" bnav-on":"")} onClick={()=>setTab("stylist")}>
          <span className="bnav-icon">✦</span><span>Stylist</span>
        </button>
        <button className={"bnav"+(tab==="market"?" bnav-on":"")} onClick={()=>{setTab("market");setMarketSelected(null)}}>
          <span className="bnav-icon">○</span><span>Market</span>
        </button>
        <button className={"bnav"+(tab==="profile"?" bnav-on":"")} onClick={()=>setTab("profile")}>
          <span className="bnav-icon">◉</span><span>Profile</span>
        </button>
      </div>

      {/* ADD MODAL */}
      {addOpen && (
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setAddOpen(false)}>
          <div className="modal">
            <div className="modal-handle"></div>
            <div className="modal-title">Add Piece</div>
            <div className="field">
              <label>Photo</label>
              <div className="photo-drop" onClick={()=>fileInputRef.current.click()}>
                {photoPreview ? <img src={photoPreview} alt="preview" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : <span className="photo-hint">Tap to photograph</span>}
                {tagging && (
                  <div className="photo-overlay">
                    <span>Reading garment</span>
                    <span className="dots"><span>.</span><span>.</span><span>.</span></span>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} style={{display:"none"}} />
              {tagError && <div className="tag-error">{tagError}</div>}
              {estimatedResale !== null && !tagging && (
                <div className="tag-success">Est. resale value: €{estimatedResale}</div>
              )}
            </div>
            <div className="field"><label>Name</label><input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Oversized wool coat" /></div>
            <div className="row2">
              <div className="field"><label>Brand</label><input value={form.brand} onChange={e=>setForm(p=>({...p,brand:e.target.value}))} placeholder="e.g. Zara" /></div>
              <div className="field"><label>Paid (€)</label><input type="number" value={form.bought_price} onChange={e=>setForm(p=>({...p,bought_price:e.target.value}))} placeholder="0" /></div>
            </div>
            <div className="row2">
              <div className="field"><label>Category</label>
                <select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))}>
                  {["Tops","Bottoms","Dresses","Shoes","Accessories"].map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label>Size</label><input value={form.size} onChange={e=>setForm(p=>({...p,size:e.target.value}))} placeholder="e.g. M, 32, 38" /></div>
            </div>
            <div className="field"><label>Condition</label>
              <select value={form.condition} onChange={e=>setForm(p=>({...p,condition:e.target.value}))}>
                {["Like new","Excellent","Good","Fair"].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <button className="btn-primary" onClick={addItem} disabled={uploading || tagging}>{uploading?"Saving...":tagging?"Reading garment...":"Add to Wardrobe"}</button>
          </div>
        </div>
      )}

      {/* LIST MODAL */}
      {listOpen && selected && (
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setListOpen(false)}>
          <div className="modal">
            <div className="modal-handle"></div>
            <div className="modal-title">List for Sale</div>
            <div className="list-preview">
              <div className="list-thumb">{selected.image_url ? <img src={selected.image_url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : selected.emoji}</div>
              <div>
                <div style={{fontWeight:300,color:"var(--fg)",fontSize:14}}>{selected.name}</div>
                <div style={{fontSize:11,color:"var(--fg-faint)",fontStyle:"italic",marginTop:3}}>{selected.brand} — {selected.condition}</div>
              </div>
            </div>
            <div className="field">
              <label>Asking Price (€) — Suggested: €{SUGGEST(selected)}</label>
              <input type="number" value={listPrice} onChange={e=>setListPrice(e.target.value)} />
            </div>
            <button className="btn-primary" onClick={listItem}>List Now</button>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM */}
      {deleteConfirm && (
        <div className="modal-bg" onClick={()=>setDeleteConfirm(null)}>
          <div className="modal">
            <div className="modal-handle"></div>
            <div className="modal-title">Delete Item?</div>
            <div style={{textAlign:'center',color:'var(--fg-dim)',fontSize:14,fontStyle:'italic',marginBottom:26}}>This cannot be undone.</div>
            <button className="btn-delete" onClick={()=>deleteItem(deleteConfirm)} style={{marginBottom:10}}>Yes, Delete</button>
            <button className="btn-secondary" onClick={()=>setDeleteConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className={"toast"+(toastOn?" toast-on":"")}>{toast}</div>
    </div>
  )
}
