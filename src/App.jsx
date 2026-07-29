import { useState, useRef, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Auth from './Auth'
import './App.css'

const CATS = ["All","Tops","Bottoms","Dresses","Shoes","Accessories"]
const EMOJIS = { Tops:"🧥", Bottoms:"👖", Dresses:"👗", Shoes:"👟", Accessories:"👜" }
const SUGGEST = (item) => Math.round((item.bought_price||0) * (item.condition==="Like new"?0.65:item.condition==="Excellent"?0.5:0.35))
const BUCKET = "clothing-clicks"

export default function App() {
  const [session, setSession] = useState(null)
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    supabase.auth.onAuthStateChange((_event, session) => setSession(session))
  }, [])

  useEffect(() => { if (session) fetchItems() }, [session])

  if (!session) return <Auth />

  async function fetchItems() {
    setLoading(true)
    const { data, error } = await supabase.from('items').select('*').order('created_at', { ascending: false })
    if (!error) setItems(data.map(i => ({ ...i, emoji: EMOJIS[i.category]||"👕" })))
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
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(fileName, photoFile)
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
        image_url = urlData.publicUrl
      }
    }
    const { data, error } = await supabase.from('items').insert([{
      name: form.name, brand: form.brand, category: form.category,
      condition: form.condition, bought_price: parseFloat(form.bought_price)||0,
      wears: 0, status: 'wardrobe', image_url,
      user_id: session.user.id,
    }]).select()
    setUploading(false)
    if (!error) {
      setItems(p => [{ ...data[0], emoji: EMOJIS[data[0].category] }, ...p])
      setAddOpen(false)
      setForm({ name:"", brand:"", category:"Tops", condition:"Good", bought_price:"" })
      setPhotoFile(null); setPhotoPreview(null)
      showToast("Added")
    }
  }

  async function listItem() {
    const price = parseFloat(listPrice)
    if (!price) return
    const { error } = await supabase.from('items').update({ status:'listed', listed_price:price }).eq('id', selected.id)
    if (!error) {
      setItems(p => p.map(i => i.id===selected.id ? {...i, status:"listed", listed_price:price} : i))
      setListOpen(false); setSelected(null)
      showToast("Listed")
    }
  }

  async function logWear(id) {
    const item = items.find(i => i.id===id)
    const { error } = await supabase.from('items').update({ wears: item.wears+1 }).eq('id', id)
    if (!error) { setItems(p => p.map(i => i.id===id ? {...i, wears:i.wears+1} : i)); showToast("Wear logged") }
  }

  async function unlist(id) {
    const { error } = await supabase.from('items').update({ status:'wardrobe', listed_price:null }).eq('id', id)
    if (!error) { setItems(p => p.map(i => i.id===id ? {...i, status:"wardrobe", listed_price:null} : i)); setSelected(null); showToast("Unlisted") }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
    setItems([])
  }

  const wardrobeItems = items.filter(i => catFilter==="All" || i.category===catFilter)
  const listedItems = items.filter(i => i.status==="listed")

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">un<span>archive</span></div>
        <button onClick={signOut} style={{background:'none',border:'none',color:'#333',fontSize:9,fontFamily:"'Cinzel',serif",letterSpacing:2,textTransform:'uppercase',cursor:'pointer'}}>Sign out</button>
      </div>

      {tab==="wardrobe" && !selected && (
        <div className="screen">
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
          {loading
            ? <div className="empty">Loading...</div>
            : wardrobeItems.length===0
            ? <div className="empty">Your wardrobe is empty.<br/>Add your first piece.</div>
            : <div className="grid">
                {wardrobeItems.map(item=>(
                  <div key={item.id} className="item-card" onClick={()=>setSelected(item)}>
                    <div className="item-img">
                      {item.image_url ? <img src={item.image_url} alt={item.name} style={{width:"100%",height:"100%",objectFit:"cover"}} /> : item.emoji}
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

      {tab==="wardrobe" && selected && (
        <div className="screen">
          <button className="back-btn" onClick={()=>setSelected(null)}>← Back</button>
          <div className="detail-img">{selected.image_url ? <img src={selected.image_url} alt={selected.name} style={{width:"100%",height:"100%",objectFit:"cover"}} /> : selected.emoji}</div>
          <div className="detail-name">{selected.name}</div>
          <div className="detail-meta">{selected.brand} — {selected.category} — {selected.condition}</div>
          <div className="cpw-row">
            <span className="cpw-lbl">Cost per wear</span>
            <span className="cpw-val">€{selected.wears>0?(selected.bought_price/selected.wears).toFixed(2):selected.bought_price}</span>
          </div>
          <div className="detail-actions">
            {selected.status!=="listed"
              ? <button className="btn-primary" onClick={()=>{setListPrice(String(SUGGEST(selected)));setListOpen(true)}}>Sell This Piece</button>
              : <button className="btn-secondary" onClick={()=>unlist(selected.id)}>Remove Listing — €{selected.listed_price}</button>}
            <button className="btn-secondary" onClick={()=>logWear(selected.id)}>Log a Wear</button>
          </div>
        </div>
      )}

      {tab==="sell" && (
        <div className="screen">
          <div className="stats-row">
            <div className="stat"><div className="stat-val">{listedItems.length}</div><div className="stat-lbl">Active</div></div>
            <div className="stat"><div className="stat-val">€{listedItems.reduce((s,i)=>s+(i.listed_price||0),0)}</div><div className="stat-lbl">Listed</div></div>
            <div className="stat"><div className="stat-val">€0</div><div className="stat-lbl">Earned</div></div>
          </div>
          <div className="section-lbl">Active Listings</div>
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

      {tab==="market" && (
        <div className="screen">
          <div className="empty">Marketplace coming soon.</div>
        </div>
      )}

      <div className="bottom-nav">
        <button className={"bnav"+(tab==="wardrobe"?" bnav-on":"")} onClick={()=>{setTab("wardrobe");setSelected(null)}}>
          <span className="bnav-icon">👗</span><span>Wardrobe</span>
        </button>
        <button className={"bnav"+(tab==="sell"?" bnav-on":"")} onClick={()=>setTab("sell")}>
          <span className="bnav-icon">◇</span><span>Sell</span>
        </button>
        <button className={"bnav"+(tab==="market"?" bnav-on":"")} onClick={()=>setTab("market")}>
          <span className="bnav-icon">○</span><span>Market</span>
        </button>
      </div>

      {addOpen && (
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setAddOpen(false)}>
          <div className="modal">
            <div className="modal-handle"></div>
            <div className="modal-title">Add Piece</div>
            <div className="field">
              <label>Photo</label>
              <div onClick={()=>fileInputRef.current.click()} style={{width:"100%",height:140,background:"#0c0c0c",border:"0.5px solid #1a1a1a",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",marginBottom:4}}>
                {photoPreview ? <img src={photoPreview} alt="preview" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : <span style={{color:"#282828",fontSize:11,fontFamily:"Cinzel,serif",letterSpacing:3,textTransform:"uppercase"}}>Tap to photograph</span>}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} style={{display:"none"}} />
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
              <div className="field"><label>Condition</label>
                <select value={form.condition} onChange={e=>setForm(p=>({...p,condition:e.target.value}))}>
                  {["Like new","Excellent","Good","Fair"].map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <button className="btn-primary" onClick={addItem} disabled={uploading}>{uploading?"Saving...":"Add to Wardrobe"}</button>
          </div>
        </div>
      )}

      {listOpen && selected && (
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setListOpen(false)}>
          <div className="modal">
            <div className="modal-handle"></div>
            <div className="modal-title">List for Sale</div>
            <div className="list-preview">
              <div className="list-thumb">{selected.image_url ? <img src={selected.image_url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : selected.emoji}</div>
              <div>
                <div style={{fontWeight:300,color:"#c8c4bc",fontSize:14}}>{selected.name}</div>
                <div style={{fontSize:11,color:"#333",fontStyle:"italic",marginTop:3}}>{selected.brand} — {selected.condition}</div>
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

      <div className={"toast"+(toastOn?" toast-on":"")}>{toast}</div>
    </div>
  )
}