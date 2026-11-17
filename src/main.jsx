import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { InboxProvider } from './context/InboxContext'
import './index.css'
import './styles/jobs.css'
import './styles/directory.css'
import './styles/marketplace.css'
import './styles/social.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <InboxProvider>
          <App />
        </InboxProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
