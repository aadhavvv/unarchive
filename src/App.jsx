import { useState, useRef, useEffect } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

const CATS = ["All","Tops","Bottoms","Dresses","Shoes","Accessories"]
const EMOJIS = { Tops:"🧥", Bottoms:"👖", Dresses:"👗", Shoes:"👟", Accessories:"👜" }
const BGS = { Tops:"#E8E4DE", Bottoms:"#3A5A8A", Dresses:"#F5D0D0", Shoes:"#F0F0F0", Accessories:"#C4B9A8" }
const SUGGEST = (item) => Math.round((item.bought_price||0) * (item.condition==="Like new"?0.65:item.condition==="Excellent"?0.5:0.35))
const BUCKET = "clothing-clicks"

export default function App() {
  const [tab, setTab] = useState("wardrobe")
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [listPrice, setListPrice] = useState("")
  const [catFilter, setCatFilter] = useState("All")
  const [toast, setToast] = useState("")
  const [toastOn, setToastOn] = useState(false)
  const [form, setForm] = useState({ name:"", brand:"", category:"Tops", condition:"Good", bought_price:"" })
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const timer = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    setLoading(true)
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.error(error)
      showToast("Couldn't load wardrobe")
    } else {
      setItems(data.map(i => ({
        ...i,
        emoji: EMOJIS[i.category] || "👕",
        bg: BGS[i.category] || "#E8E4DE",
      })))
    }
    setLoading(false)
  }

  function showToast(msg) {
    setToast(msg); setToastOn(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToastOn(false), 2200)
  }

  function handlePhotoSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function addItem() {
    if (!form.name || !form.brand) return
    setUploading(true)

    let image_url = null
    if (photoFile) {
      const ext = photoFile.name.split('.').pop()
      const fileName = `${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, photoFile)

      if (uploadError) {
        console.error(uploadError)
        showToast("Photo upload failed")
      } else {
        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
        image_url = urlData.publicUrl
      }
    }

    const { data, error } = await supabase
      .from('items')
      .insert([{
        name: form.name,
        brand: form.brand,
        category: form.category,
        condition: form.condition,
        bought_price: parseFloat(form.bought_price) || 0,
        wears: 0,
        status: 'wardrobe',
        image_url,
      }])
      .select()

    setUploading(false)

    if (error) {
      console.error(error)
      showToast("Couldn't save item")
      return
    }

    setItems(p => [{ ...data[0], emoji: EMOJIS[data[0].category], bg: BGS[data[0].category] }, ...p])
    setAddOpen(false)
    setForm({ name:"", brand:"", category:"Tops", condition:"Good", bought_price:"" })
    setPhotoFile(null)
    setPhotoPreview(null)
    showToast("Added to wardrobe ✓")
  }

  async function listItem() {
    const price = parseFloat(listPrice)
    if (!price) return
    const { error } = await supabase
      .from('items')
      .update({ status: 'listed', listed_price: price })
      .eq('id', selected.id)
    if (error) { showToast("Couldn't list item"); return }
    setItems(p => p.map(i => i.id===selected.id ? {...i, status:"listed", listed_price:price} : i))
    setListOpen(false); setSelected(null)
    showToast("Listed for sale ✓")
  }

  async function logWear(id) {
    const item = items.find(i => i.id === id)
    const { error } = await supabase
      .from('items')
      .update({ wears: item.wears + 1 })
      .eq('id', id)
    if (error) { showToast("Couldn't log wear"); return }
    setItems(p => p.map(i => i.id===id ? {...i, wears:i.wears+1} : i))
    showToast("Wear logged ✓")
  }

  async function unlist(id) {
    const { error } = await supabase
      .from('items')
      .update({ status: 'wardrobe', listed_price: null })
      .eq('id', id)
    if (error) { showToast("Couldn't remove listing"); return }
    setItems(p => p.map(i => i.id===id ? {...i, status:"wardrobe", listed_price:null} : i))
    setSelected(null); showToast("Removed from listings")
  }

  const wardrobeItems = items.filter(i => catFilter==="All" || i.category===catFilter)
  const listedItems = items.filter(i => i.status==="listed")

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">re<span>wear</span></div>
      </div>

      {/* WARDROBE TAB */}
      {tab==="wardrobe" && !selected && (
        <div className="screen">
          <div className="stats-row">
            <div className="stat"><div className="stat-val">{items.length}</div><div className="stat-lbl">items</div></div>
            <div className="stat"><div className="stat-val">€{items.reduce((s,i)=>s+(i.bought_price||0),0)}</div><div className="stat-lbl">total value</div></div>
            <div className="stat"><div className="stat-val">{listedItems.length}</div><div className="stat-lbl">listed</div></div>
          </div>
          <button className="add-btn" onClick={()=>setAddOpen(true)}>+ Add item</button>
          <div className="section-lbl">My wardrobe</div>
          <div className="chips">
            {CATS.map(c=><button key={c} className={"chip"+(catFilter===c?" chip-on":"")} onClick={()=>setCatFilter(c)}>{c}</button>)}
          </div>
          {loading ? (
            <div className="empty">Loading your wardrobe...</div>
          ) : wardrobeItems.length===0 ? (
            <div className="empty">No items yet.<br/>Tap "+ Add item" to get started.</div>
          ) : (
            <div className="grid">
              {wardrobeItems.map(item=>(
                <div key={item.id} className="item-card" onClick={()=>setSelected(item)}>
                  <div className="item-img" style={{background:item.bg}}>
                    {item.image_url
                      ? <img src={item.image_url} alt={item.name} style={{width:"100%",height:"100%",objectFit:"cover"}} />
                      : item.emoji}
                  </div>
                  <div className="item-body">
                    <div className="item-name">{item.name}</div>
                    <div className="item-brand">{item.brand}</div>
                    <div className="item-foot">
                      {item.status==="listed"
                        ? <span className="badge badge-green">Listed</span>
                        : <span className="badge badge-purple">{item.wears}× worn</span>}
                      <span className="item-price">€{item.bought_price}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ITEM DETAIL */}
      {tab==="wardrobe" && selected && (
        <div className="screen">
          <button className="back-btn" onClick={()=>setSelected(null)}>← Back</button>
          <div className="detail-img" style={{background:selected.bg}}>
            {selected.image_url
              ? <img src={selected.image_url} alt={selected.name} style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:4}} />
              : selected.emoji}
          </div>
          <div className="detail-name">{selected.name}</div>
          <div className="detail-meta">{selected.brand} · {selected.category} · {selected.condition}</div>
          <div className="cpw-row">
            <span className="cpw-lbl">Cost per wear</span>
            <span className="cpw-val">€{selected.wears>0?(selected.bought_price/selected.wears).toFixed(2):selected.bought_price}</span>
          </div>
          <div className="detail-actions">
            {selected.status!=="listed"
              ? <button className="btn-primary" onClick={()=>{setListPrice(String(SUGGEST(selected)));setListOpen(true)}}>🏷 Sell this item</button>
              : <button className="btn-secondary" onClick={()=>unlist(selected.id)}>✕ Remove listing (€{selected.listed_price})</button>}
            <button className="btn-secondary" onClick={()=>logWear(selected.id)}>👕 Log a wear</button>
          </div>
        </div>
      )}

      {/* SELL TAB */}
      {tab==="sell" && (
        <div className="screen">
          <div className="stats-row">
            <div className="stat"><div className="stat-val">{listedItems.length}</div><div className="stat-lbl">active</div></div>
            <div className="stat"><div className="stat-val">€{listedItems.reduce((s,i)=>s+(i.listed_price||0),0)}</div><div className="stat-lbl">listed value</div></div>
            <div className="stat"><div className="stat-val">€0</div><div className="stat-lbl">earned</div></div>
          </div>
          <div className="section-lbl">Your listings</div>
          {listedItems.length===0
            ? <div className="empty">No active listings.<br/>Go to your wardrobe and tap "Sell this item".</div>
            : listedItems.map(item=>(
              <div key={item.id} className="list-row" onClick={()=>{setTab("wardrobe");setSelected(item)}}>
                <div className="list-thumb" style={{background:item.bg}}>
                  {item.image_url ? <img src={item.image_url} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:4}} /> : item.emoji}
                </div>
                <div className="list-info">
                  <div className="list-name">{item.name}</div>
                  <div className="list-meta">{item.brand} · {item.condition}</div>
                </div>
                <div className="list-price">€{item.listed_price}</div>
              </div>
            ))}
        </div>
      )}

      {/* MARKET TAB (placeholder, not yet connected to other users) */}
      {tab==="market" && (
        <div className="screen">
          <div className="empty">Marketplace browsing coming soon —<br/>this will show listings from other rewear users.</div>
        </div>
      )}

      {/* BOTTOM NAV */}
      <div className="bottom-nav">
        <button className={"bnav"+(tab==="wardrobe"?" bnav-on":"")} onClick={()=>{setTab("wardrobe");setSelected(null)}}>
          <span className="bnav-icon">👗</span><span>Wardrobe</span>
        </button>
        <button className={"bnav"+(tab==="sell"?" bnav-on":"")} onClick={()=>setTab("sell")}>
          <span className="bnav-icon">🏷</span><span>Sell</span>
        </button>
        <button className={"bnav"+(tab==="market"?" bnav-on":"")} onClick={()=>setTab("market")}>
          <span className="bnav-icon">🛍</span><span>Market</span>
        </button>
      </div>

      {/* ADD MODAL */}
      {addOpen && (
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setAddOpen(false)}>
          <div className="modal">
            <div className="modal-handle"></div>
            <div className="modal-title">Add to wardrobe</div>

            <div className="field">
              <label>Photo</label>
              <div
                onClick={()=>fileInputRef.current.click()}
                style={{
                  width:"100%", aspectRatio:"3/4", maxHeight:180, borderRadius:8,
                  border:"1px dashed #4a3f56", display:"flex", alignItems:"center", justifyContent:"center",
                  background:"#0a0a0d", cursor:"pointer", overflow:"hidden", marginBottom:4
                }}
              >
                {photoPreview
                  ? <img src={photoPreview} alt="preview" style={{width:"100%",height:"100%",objectFit:"cover"}} />
                  : <span style={{color:"#8b8494", fontSize:14, fontStyle:"italic"}}>📷 Tap to add a photo</span>}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoSelect}
                style={{display:"none"}}
              />
            </div>

            <div className="field"><label>Item name</label><input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Oversized denim jacket" /></div>
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
              <div className="field"><label>Condition</label>
                <select value={form.condition} onChange={e=>setForm(p=>({...p,condition:e.target.value}))}>
                  {["Like new","Excellent","Good","Fair"].map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <button className="btn-primary" onClick={addItem} disabled={uploading}>
              {uploading ? "Saving..." : "Add to wardrobe"}
            </button>
          </div>
        </div>
      )}

      {/* LIST MODAL */}
      {listOpen && selected && (
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setListOpen(false)}>
          <div className="modal">
            <div className="modal-handle"></div>
            <div className="modal-title">List for sale</div>
            <div className="list-preview">
              <span style={{fontSize:32}}>{selected.image_url ? <img src={selected.image_url} alt="" style={{width:40,height:40,objectFit:"cover",borderRadius:4}} /> : selected.emoji}</span>
              <div>
                <div style={{fontWeight:500}}>{selected.name}</div>
                <div style={{fontSize:13,color:"#888"}}>{selected.brand} · {selected.condition}</div>
              </div>
            </div>
            <div className="field">
              <label>Asking price (€) — suggested: €{SUGGEST(selected)}</label>
              <input type="number" value={listPrice} onChange={e=>setListPrice(e.target.value)} />
            </div>
            <button className="btn-primary" onClick={listItem}>List now</button>
          </div>
        </div>
      )}

      <div className={"toast"+(toastOn?" toast-on":"")}>{toast}</div>
    </div>
  )
}