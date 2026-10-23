import { Box, Button, Text } from '@chakra-ui/react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { secondaryButton } from '@/components/ui'

interface State {
  error: Error | null
}

/**
 * Keeps a failing page from blanking the whole app; offers a reload. Keyed by route in AppShell, so navigating away
 * remounts it and clears the error.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ReGrow page error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Box maxW="560px" mx="auto" my="20" px="6" textAlign="center">
        <Text fontFamily="heading" fontSize="title" fontWeight="600">
          Something went wrong on this page
        </Text>
        <Text color="fg.muted" mt="2" fontSize="small">
          The rest of ReGrow still works. Reloading usually helps; if it keeps happening, the data service may be
          unavailable.
        </Text>
        <Text fontFamily="mono" fontSize="caption" color="fg.subtle" mt="4" wordBreak="break-word">
          {this.state.error.message}
        </Text>
        <Button mt="6" {...secondaryButton} onClick={() => window.location.reload()}>
          Reload
        </Button>
      </Box>
    )
  }
}
