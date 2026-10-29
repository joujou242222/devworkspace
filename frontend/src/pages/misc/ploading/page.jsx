import React from 'react'
import { createRoot } from 'react-dom/client'
import '././loading.css'
import Doc from '../../../app/Doc.jsx'
import Body from './body.html?raw'
import PageScriptRaw from './page.js.txt?raw'
import ShellScriptRaw from '../../../app/shell.js.txt?raw'

const seg = t => t.split('/*@@BLOCK@@*/').map(s => s.trim()).filter(Boolean)
const scripts = [seg(PageScriptRaw), seg(ShellScriptRaw)]

createRoot(document.getElementById('root')).render(<Doc body={Body} scripts={scripts} />)
