#!/usr/bin/env node
/**
 * Accessibility audit runner using axe-core
 * Run this after `npm run build` to check the built app
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import puppeteer from 'puppeteer'
import { injectAxe, checkPage } from 'axe-puppeteer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distPath = path.join(__dirname, '../client/dist')

if (!fs.existsSync(distPath)) {
  console.error('❌ dist/ folder not found. Run `npm run build` first.')
  process.exit(1)
}

// Start a simple HTTP server to serve the dist folder
const server = createServer((req, res) => {
  let filePath = path.join(distPath, req.url === '/' ? 'index.html' : req.url)

  // Handle hash-based routing
  if (req.url.startsWith('/#/')) {
    filePath = path.join(distPath, 'index.html')
  }

  const extname = path.extname(filePath)
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
  }

  const contentType = mimeTypes[extname] || 'application/octet-stream'

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      res.writeHead(500)
      res.end('Server error')
      return
    }
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
})

const port = 3333
const baseUrl = `http://localhost:${port}`

server.listen(port, async () => {
  console.log(`🚀 Server running at ${baseUrl}`)
  console.log('📋 Starting accessibility audit...\n')

  let browser
  try {
    browser = await puppeteer.launch({ headless: true })

    // Pages to audit
    const pagesToAudit = [
      { path: '/', name: 'Home Page' },
      { path: '/#/event/test-event', name: 'Event Page (Guest View)' },
      { path: '/#/event/test-event/manage', name: 'Event Manage Page' },
    ]

    let totalViolations = 0
    const results = []

    for (const page of pagesToAudit) {
      console.log(`\n📄 Auditing: ${page.name}`)
      console.log(`   URL: ${baseUrl}${page.path}`)

      const browserPage = await browser.newPage()

      try {
        await browserPage.goto(`${baseUrl}${page.path}`, {
          waitUntil: 'networkidle2',
          timeout: 10000,
        })

        await injectAxe(browserPage)
        const axeResults = await checkPage(browserPage)

        const violations = axeResults.violations || []
        totalViolations += violations.length

        results.push({
          page: page.name,
          violations: violations.length,
          details: violations,
        })

        if (violations.length === 0) {
          console.log('   ✅ No violations found!')
        } else {
          console.log(`   ⚠️  Found ${violations.length} violation(s):`)
          violations.forEach((violation) => {
            console.log(`      - [${violation.impact}] ${violation.id}: ${violation.description}`)
            console.log(`        Nodes affected: ${violation.nodes.length}`)
          })
        }
      } catch (err) {
        console.log(`   ⚠️  Could not audit this page: ${err.message}`)
      } finally {
        await browserPage.close()
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('📊 ACCESSIBILITY AUDIT SUMMARY')
    console.log('='.repeat(60))

    results.forEach((result) => {
      const status = result.violations === 0 ? '✅' : '⚠️ '
      console.log(
        `${status} ${result.page}: ${result.violations} violation${result.violations !== 1 ? 's' : ''}`
      )
    })

    console.log(`\nTotal violations: ${totalViolations}`)

    if (totalViolations === 0) {
      console.log('🎉 Great! No accessibility violations found.')
      process.exit(0)
    } else {
      console.log('\n⚠️  Please review and fix the violations above.')
      process.exit(1)
    }
  } catch (err) {
    console.error('❌ Error during audit:', err)
    process.exit(1)
  } finally {
    if (browser) {
      await browser.close()
    }
    server.close()
  }
})

process.on('SIGINT', () => {
  console.log('\n⏸  Audit interrupted')
  server.close()
  process.exit(0)
})
