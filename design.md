# Parasite Skill Design

## Overview

Parasite Skill is a runtime injection system that enhances AI clients without modifying their source code. It provides build-time hooks, server wrapping, and traceability protection capabilities.

## Core Design Principles

### 1. Non-Invasive Enhancement
- Never modify original source files
- Use extension folders for each client
- Inject at runtime or build-time only
- Fully toggleable and removable

### 2. Universal Compatibility
- Works with any AI client (Claude Code, Codex, OpenCode, etc.)
- Supports multiple build tools (Vite, webpack, Rollup)
- Compatible with any server framework (Express, Fastify, Koa)

### 3. Privacy-First Architecture
- All injections stored locally
- No external data sharing
- Traceability protection for extracted code
- Zero telemetry

### 4. Developer Experience
- Simple CLI interface
- Clear documentation
- Interactive playground for testing
- Visual graph of skill relationships

## Visual Design

### Color Palette
- Primary: #6366f1 (Indigo)
- Secondary: #8b5cf6 (Violet)
- Accent: #06b6d4 (Cyan)
- Success: #10b981 (Emerald)
- Warning: #f59e0b (Amber)
- Error: #ef4444 (Red)
- Background: #0f172a (Slate 900)
- Surface: #1e293b (Slate 800)
- Text: #f8fafc (Slate 50)

### Typography
- Headings: Inter, system-ui
- Body: Inter, system-ui
- Code: JetBrains Mono, Fira Code

### Layout
- Max width: 1200px
- Grid: 12 columns
- Spacing: 8px base unit
- Border radius: 8px (sm), 12px (md), 16px (lg)

## Components

### 1. Header
- Logo + project name
- Navigation links
- GitHub stars button
- Theme toggle (dark/light)

### 2. Hero Section
- Animated headline
- Brief description
- Call-to-action buttons
- Feature highlights

### 3. Feature Cards
- Icon + title + description
- Hover effects
- Link to detailed docs

### 4. Interactive Graph
- D3.js or vis.js visualization
- Nodes: skills, clients, hooks
- Edges: relationships, dependencies
- Zoom, pan, click interactions
- Filter by category

### 5. Code Examples
- Syntax highlighting
- Copy button
- Live preview (where applicable)

### 6. Documentation Sections
- Getting Started
- API Reference
- Examples
- Contributing

## Interactive Elements

### 1. Skill Router Playground
- Input: idea text
- Output: ranked skills with scores
- Real-time updates
- Visual flow diagram

### 2. Injection Manager
- List of active injections
- Toggle on/off
- Add new injection form
- Preview injection code

### 3. Build Hook Generator
- Select build tool (Vite/webpack)
- Configure injection points
- Generate plugin code
- Download or copy

### 4. Server Wrapper Generator
- Select server framework
- Choose enhancement type
- Configure middleware/routes
- Generate wrapper code

## Responsive Design

### Mobile (< 768px)
- Single column layout
- Collapsible navigation
- Simplified graph view
- Touch-friendly interactions

### Tablet (768px - 1024px)
- Two column layout
- Partial graph view
- Side navigation

### Desktop (> 1024px)
- Full 12-column grid
- Complete graph visualization
- Side-by-side code examples

## Animations

### Page Transitions
- Fade in/out (200ms ease)
- Slide up for content

### Micro-interactions
- Button hover: scale(1.02)
- Card hover: translateY(-4px)
- Graph node hover: glow effect
- Loading states: skeleton screens

### Graph Animations
- Node appear: scale from 0
- Edge drawing: path animation
- Filter transitions: fade

## Accessibility

### WCAG 2.1 AA Compliance
- Color contrast ratios ≥ 4.5:1
- Keyboard navigation support
- Screen reader friendly
- Focus indicators

### Interactive Elements
- ARIA labels
- Role attributes
- Live regions for updates
- Skip navigation links

## Performance

### Targets
- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Cumulative Layout Shift: < 0.1
- First Input Delay: < 100ms

### Optimization
- Lazy loading for images
- Code splitting
- Tree shaking
- Compression (gzip/brotli)

## Technology Stack

### Frontend
- React 18+ with TypeScript
- Tailwind CSS for styling
- D3.js for graph visualization
- Framer Motion for animations
- React Router for navigation

### Build Tools
- Vite for development
- esbuild for bundling
- PostCSS for CSS processing

### Deployment
- GitHub Pages for static site
- GitHub Actions for CI/CD
- Netlify/Vercel as fallback

## Brand Guidelines

### Voice & Tone
- Professional but approachable
- Technical but not intimidating
- Helpful and encouraging
- Clear and concise

### Messaging
- Tagline: "Enhance without modifying"
- Value props:
  - Non-invasive
  - Universal compatibility
  - Privacy-first
  - Developer-friendly

### Visual Identity
- Modern, clean aesthetic
- Dark mode by default
- Subtle gradients
- Consistent iconography
