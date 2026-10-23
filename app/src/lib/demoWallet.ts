import { MARK_PATH, MARK_VIEWBOX } from '@/lib/brand'
import type { Wallet } from '@rainbow-me/rainbowkit'
import {
  type Chain,
  createPublicClient,
  createWalletClient,
  type EIP1193RequestFn,
  type Hex,
  http,
  numberToHex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createConnector } from 'wagmi'
import { API_URL } from './api'

/**
 * Throwaway in-browser wallet for testnet demos: no extension, no crypto knowledge.
 * The key lives in this browser only; our API tops it up with free test ETH for fees.
 */
const KEY = 'regrow-demo-wallet-key'
const CONNECTED = 'regrow-demo-wallet-connected'
let memoryKey: Hex | null = null

function storage<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function loadKey(): Hex {
  const saved = storage(() => localStorage.getItem(KEY) as Hex | null, null)
  if (saved) return saved
  const fresh = memoryKey ?? generatePrivateKey()
  memoryKey = fresh
  storage(() => localStorage.setItem(KEY, fresh), undefined)
  return fresh
}

export async function requestDemoGas(address: string) {
  const res = await fetch(`${API_URL}/demo/gas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `gas request failed (${res.status})`)
  return (await res.json()) as { funded: boolean; tx?: string }
}

function demoConnector(chain: Chain, rpcUrl?: string) {
  return createConnector((config) => {
    const account = () => privateKeyToAccount(loadKey())
    const transport = http(rpcUrl || undefined)
    const publicClient = createPublicClient({ chain, transport })

    const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
      const acct = account()
      const p = (params ?? []) as unknown[]
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [acct.address]
        case 'eth_chainId':
          return numberToHex(chain.id)
        case 'eth_sendTransaction': {
          const tx = p[0] as { to?: Hex; data?: Hex; value?: Hex; gas?: Hex }
          const wallet = createWalletClient({ account: acct, chain, transport })
          return wallet.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : undefined,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          })
        }
        case 'personal_sign':
          return acct.signMessage({ message: { raw: p[0] as Hex } })
        case 'wallet_switchEthereumChain':
          return null
        default:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return publicClient.request({ method, params } as any)
      }
    }
    const provider = { request: request as EIP1193RequestFn, on: () => {}, removeListener: () => {} }

    return {
      id: 'regrowDemo',
      name: 'Demo wallet',
      type: 'regrowDemo',
      async connect() {
        storage(() => localStorage.setItem(CONNECTED, '1'), undefined)
        const address = account().address
        requestDemoGas(address).catch(() => {}) // best effort; the UI also shows gas status
        // wagmi's connect() return type is generic over `withCapabilities`; plain accounts are what we return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { accounts: [address], chainId: chain.id } as any
      },
      async disconnect() {
        storage(() => localStorage.removeItem(CONNECTED), undefined)
      },
      async getAccounts() {
        return [account().address]
      },
      async getChainId() {
        return chain.id
      },
      async getProvider() {
        return provider
      },
      async isAuthorized() {
        return storage(() => localStorage.getItem(CONNECTED) === '1', false)
      },
      async switchChain() {
        return chain
      },
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {
        config.emitter.emit('disconnect')
      },
    }
  })
}

const ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}"><rect width="1417.5" height="1417.5" rx="320" fill="#0f7f56"/><path transform="translate(248 248) scale(0.65)" fill="#fff" d="${MARK_PATH}"/></svg>`,
  )

export const demoWallet =
  (chain: Chain, rpcUrl?: string) =>
  (): Wallet => ({
    id: 'regrowDemo',
    name: 'Demo wallet',
    shortName: 'Demo wallet',
    iconUrl: ICON,
    iconBackground: '#2f7a4a',
    installed: true,
    createConnector: (walletDetails) =>
      createConnector((config) => ({ ...demoConnector(chain, rpcUrl)(config), ...walletDetails })),
  })
