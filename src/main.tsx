import '@fontsource/fira-code/latin-500.css'
import '@fontsource/fira-code/latin-600.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './styles/tokens.css'
import './styles/global.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element is missing')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
