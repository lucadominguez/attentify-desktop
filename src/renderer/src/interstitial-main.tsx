import React from 'react'
import ReactDOM from 'react-dom/client'
import InterstitialWarning from './components/InterstitialWarning'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('interstitial-root')!).render(
  <React.StrictMode>
    <InterstitialWarning />
  </React.StrictMode>
)
