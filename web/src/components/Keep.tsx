import { Component, type ReactNode } from 'react'

/**
 * Keeps one broken part of the screen from taking the rest down with it. A
 * panel that throws while it renders is left out (and logged) while the office
 * keeps running; in dev, saving a fix brings it back.
 */
export class Keep extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(`[HQ] ${this.props.name} stopped drawing:`, error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
