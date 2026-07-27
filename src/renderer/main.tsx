import { StrictMode, useEffect, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import { App } from './App'
import { ThemeProvider } from './theme/ThemeProvider'
import { connectAppStore } from './store/useAppStore'

function Root(): JSX.Element {
  // Subscribe before first paint so the initial snapshot is not missed.
  useEffect(() => connectAppStore(), [])

  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
