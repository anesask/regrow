import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import { coinbaseWallet, metaMaskWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets'
import { createConfig, http, type Transport } from 'wagmi'
import { baseSepolia, foundry, sepolia } from 'wagmi/chains'
import { demoWallet } from './demoWallet'

const chains = { [baseSepolia.id]: baseSepolia, [sepolia.id]: sepolia, [foundry.id]: foundry } as const

export const chain = chains[Number(import.meta.env.VITE_CHAIN_ID ?? baseSepolia.id) as keyof typeof chains] ?? baseSepolia
const rpcUrl: string | undefined = import.meta.env.VITE_RPC_URL || undefined
const projectId: string = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || ''

const connectors = connectorsForWallets(
  [
    { groupName: 'No crypto needed', wallets: [demoWallet(chain, rpcUrl)] },
    {
      groupName: 'Your own wallet',
      // official icons; other installed extensions are detected on their own (EIP-6963). Phone wallets need a WalletConnect id
      wallets: projectId ? [metaMaskWallet, coinbaseWallet, walletConnectWallet] : [metaMaskWallet, coinbaseWallet],
    },
  ],
  { appName: 'ReGrow', projectId: projectId || 'regrow-dev' },
)

export const wagmiConfig = createConfig({
  connectors,
  chains: [chain],
  transports: { [chain.id]: http(rpcUrl) } as Record<(typeof chain)['id'], Transport>,
})

export const explorerUrl = chain.blockExplorers?.default.url ?? ''
export const txUrl = (hash: string) => `${explorerUrl}/tx/${hash}`
export const addressUrl = (addr: string) => `${explorerUrl}/address/${addr}`
