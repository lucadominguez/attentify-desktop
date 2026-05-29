import React from 'react'
import ReactDOM from 'react-dom/client'
import OverlayCard from './overlay/OverlayCard'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('overlay-root')!).render(
  <React.StrictMode>
    <OverlayCard />
  </React.StrictMode>
)
