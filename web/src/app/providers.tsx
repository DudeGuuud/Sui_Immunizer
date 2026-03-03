'use client';

import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

const { networkConfig } = createNetworkConfig({
    testnet: { url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' as 'testnet' },
    mainnet: { url: getJsonRpcFullnodeUrl('mainnet'), network: 'mainnet' as 'mainnet' },
});

type SuiNetwork = 'testnet' | 'mainnet';
const DEFAULT_NETWORK: SuiNetwork =
    (process.env.NEXT_PUBLIC_SUI_NETWORK as SuiNetwork) || 'testnet';

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            <SuiClientProvider networks={networkConfig} defaultNetwork={DEFAULT_NETWORK}>
                <WalletProvider autoConnect preferredWallets={['Slush Wallet', 'Sui Wallet']}>
                    {children}
                </WalletProvider>
            </SuiClientProvider>
        </QueryClientProvider>
    );
}
