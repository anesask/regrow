import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Abi, ContractFunctionArgs, ContractFunctionName } from 'viem'
import { usePublicClient, useWriteContract } from 'wagmi'
import { toaster } from '@/components/Toaster'
import { explorerUrl, txUrl } from './wagmi'

type Call<TAbi extends Abi, TName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>> = {
  address: `0x${string}`
  abi: TAbi
  functionName: TName
  args: ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TName>
}

/** Send a contract write, wait for the receipt, toast with an explorer link and refresh all queries. */
export function useTx() {
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<string | null>(null)

  async function send<TAbi extends Abi, TName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>>(
    label: string,
    call: Call<TAbi, TName>,
  ): Promise<`0x${string}` | null> {
    setPending(label)
    const id = toaster.create({ type: 'loading', title: label, description: 'Confirm in your wallet…' })
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await writeContractAsync(call as any)
      toaster.update(id, { type: 'loading', title: label, description: 'Waiting for confirmation…' })
      const receipt = await client!.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('transaction reverted')
      toaster.update(id, {
        type: 'success',
        title: label,
        description: `tx ${hash.slice(0, 10)}…`,
        duration: 6000,
        action: explorerUrl ? { label: 'View on explorer', onClick: () => window.open(txUrl(hash), '_blank') } : undefined,
      })
      await queryClient.invalidateQueries()
      return hash
    } catch (e) {
      const msg = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e)
      toaster.update(id, { type: 'error', title: `${label} failed`, description: msg, duration: 8000 })
      return null
    } finally {
      setPending(null)
    }
  }

  return { send, pending }
}
