import { useState } from 'react'
import { supabase } from './lib/supabase'

export default function Auth() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit() {
    setLoading(true)
    setError('')
    setMessage('')
    if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://unarchive.vercel.app' })
      if (error) setError(error.message)
      else setMessage('Check your email for a password reset link.')
      setLoading(false)
      return
    }
    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setMessage('Check your email to confirm your account.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    }
    setLoading(false)
  }

  const inp = { width:'100%', padding:'13px 12px', border:'0.5px solid #1a1a1a', fontSize:14, background:'#080808', color:'#d8d4cc', fontFamily:"'Cormorant Garamond',serif", outline:'none', boxSizing:'border-box' }
  const lbl = { fontSize:9, color:'#333', letterSpacing:3, textTransform:'uppercase', fontFamily:"'Cinzel',serif", marginBottom:6, display:'block' }
  const lnk = { background:'none', border:'none', cursor:'pointer', color:'#444', fontSize:11, fontStyle:'italic', fontFamily:"'Cormorant Garamond',serif", display:'block', marginBottom:8 }

  return (
    <div style={{minHeight:'100vh',background:'#080808',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'0 24px',fontFamily:"'Cormorant Garamond',Georgia,serif",maxWidth:430,margin:'0 auto'}}>
      <div style={{fontFamily:"'Cinzel',serif",fontSize:16,letterSpacing:8,color:'#ffffff',textTransform:'uppercase',marginBottom:48}}>un<span style={{color:'#666'}}>archive</span></div>
      <div style={{fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:4,color:'#444',textTransform:'uppercase',marginBottom:32}}>{mode==='login'?'Sign In':mode==='signup'?'Create Account':'Reset Password'}</div>
      <div style={{width:'100%',marginBottom:14}}>
        <label style={lbl}>Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" style={inp}/>
      </div>
      {mode!=='reset' && (
        <div style={{width:'100%',marginBottom:24}}>
          <label style={lbl}>Password</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==='Enter'&&handleSubmit()} style={inp}/>
        </div>
      )}
      {mode==='reset' && <div style={{marginBottom:24}}/>}
      {error&&<div style={{color:'#c0392b',fontSize:12,marginBottom:16,textAlign:'center',fontStyle:'italic'}}>{error}</div>}
      {message&&<div style={{color:'#4a6a3a',fontSize:12,marginBottom:16,textAlign:'center',fontStyle:'italic'}}>{message}</div>}
      <button onClick={handleSubmit} disabled={loading} style={{width:'100%',padding:17,background:loading?'#222':'#ffffff',color:loading?'#666':'#080808',border:'none',fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:4,textTransform:'uppercase',cursor:loading?'default':'pointer',marginBottom:16}}>
        {loading?'Please wait...':mode==='login'?'Sign In':mode==='signup'?'Create Account':'Send Reset Link'}
      </button>
      {mode==='login' && <>
        <button onClick={()=>{setMode('signup');setError('');setMessage('');}} style={lnk}>Don't have an account? Sign up</button>
        <button onClick={()=>{setMode('reset');setError('');setMessage('');}} style={lnk}>Forgot password?</button>
      </>}
      {mode==='signup' && <button onClick={()=>{setMode('login');setError('');setMessage('');}} style={lnk}>Already have an account? Sign in</button>}
      {mode==='reset' && <button onClick={()=>{setMode('login');setError('');setMessage('');}} style={lnk}>← Back to sign in</button>}
    </div>
  )
}