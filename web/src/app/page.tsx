'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck,
  Activity,
  Globe,
  Terminal,
  Cpu,
  Zap,
  Search,
  AlertTriangle,
  ShieldAlert,
  Fingerprint,
  Lock,
  Unlock,
  Coins,
  Users,
  Eye,
  Settings,
  CheckCircle,
  Loader2,
  X,
  ChevronRight,
  ExternalLink,
  Shield,
  Building2,
  ShieldPlus,
  BadgePlus,
  ArrowUpRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  useSuiClientQuery,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSignPersonalMessage,
  ConnectButton,
  useSuiClient,
} from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import MDEditor from '@uiw/react-md-editor';
import MarkdownPreview from '@uiw/react-markdown-preview';
import {
  encryptAndUpload,
  fetchAndDecrypt,
  createAndInitSessionKey,
  type SessionKey,
} from '@/lib/seal';

// ─── Configuration ────────────────────────────────────────────────────────────
const PACKAGE_ID = process.env.NEXT_PUBLIC_PACKAGE_ID || '0x_IMMUNIZER';
const REGISTRY_ID = process.env.NEXT_PUBLIC_REGISTRY_ID || '0x_REGISTRY';
const VENDOR_REGISTRY_ID = process.env.NEXT_PUBLIC_VENDOR_REGISTRY_ID || '';

// ─── Types ────────────────────────────────────────────────────────────────────
type PublishStep = 'idle' | 'encrypting' | 'uploading' | 'publishing' | 'done' | 'error';
type ActiveRole = 'GUEST' | 'VENDOR' | 'SUBSCRIBER';

interface VulnAlertEvent {
  txDigest: string;
  vuln_id?: string;
  title?: string;
  description?: string;
  severity?: number;
  blob_id?: string;
  skill_blob_id?: string;
  vendor?: string;
}

interface VendorInfo {
  address: string;
  name: string;
}

const PUBLISH_STEPS: { key: PublishStep; label: string }[] = [
  { key: 'encrypting', label: 'Encrypting with Seal...' },
  { key: 'uploading', label: 'Uploading to Walrus...' },
  { key: 'publishing', label: 'Publishing on Sui...' },
  { key: 'done', label: 'Deployed! 🎉' },
];

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function ImmunizerDashboard() {
  const [mounted, setMounted] = useState(false);
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  // Demo Role Switcher
  const [demoRole, setDemoRole] = useState<'AUTO' | 'VENDOR' | 'SUBSCRIBER'>('AUTO');

  // Publish state
  const [publishStep, setPublishStep] = useState<PublishStep>('idle');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | undefined>(
    "## [Skill] Patch for VULN-2026-X\n\n```bash\n# Patch commands here\necho 'Immunizing system...'\n```"
  );
  const [vulnTitle, setVulnTitle] = useState('');
  const [vulnDesc, setVulnDesc] = useState('');
  const [severity, setSeverity] = useState(5);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [isPublisherOpen, setIsPublisherOpen] = useState(false);

  // Decrypt / View Skill state
  const [viewingSkill, setViewingSkill] = useState<{ blobId: string; vendorAddress: string; title: string } | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const sessionKeyRef = useRef<SessionKey | null>(null);

  // Vendor detail modal
  const [viewingVendor, setViewingVendor] = useState<VendorInfo | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // ─── Live Chain Queries ─────────────────────────────────────────────────────

  // All VulnerabilityAlert events (public: title, severity, description visible to all)
  const { data: events, isLoading: eventsLoading } = useSuiClientQuery('queryEvents', {
    query: { MoveEventType: `${PACKAGE_ID}::alert::VulnerabilityAlert` },
    limit: 20,
    order: 'descending',
  });

  // VendorRegistered events — used to enrich vendor names
  const { data: vendorEvents } = useSuiClientQuery('queryEvents', {
    query: { MoveEventType: `${PACKAGE_ID}::alert::VendorRegistered` },
    limit: 50,
    order: 'descending',
  });

  // VendorRegistry shared object — real on-chain vendor list
  const { data: vendorRegistryObj } = useSuiClientQuery(
    'getObject',
    {
      id: VENDOR_REGISTRY_ID,
      options: { showContent: true },
    },
    { enabled: !!VENDOR_REGISTRY_ID && VENDOR_REGISTRY_ID !== '0x_REPLACE_AFTER_PUBLISH' && mounted },
  );

  // User's owned NFTs for role detection
  const { data: ownedObjects, isLoading: ownedLoading, refetch: refetchOwned } = useSuiClientQuery(
    'getOwnedObjects',
    {
      owner: account?.address || '',
      filter: {
        MatchAny: [
          { StructType: `${PACKAGE_ID}::alert::VendorNFT` },
          { StructType: `${PACKAGE_ID}::alert::SubscriberNFT` },
        ],
      },
      options: { showType: true },
    },
    { enabled: !!account && mounted },
  );

  // ─── Role Detection ─────────────────────────────────────────────────────────
  const realRole = useMemo((): ActiveRole => {
    if (!account) return 'GUEST';
    if (ownedLoading || !ownedObjects) return 'GUEST';
    const hasVendor = ownedObjects.data.some(o => o.data?.type?.includes('VendorNFT'));
    const hasSub = ownedObjects.data.some(o => o.data?.type?.includes('SubscriberNFT'));
    if (hasVendor) return 'VENDOR';
    if (hasSub) return 'SUBSCRIBER';
    return 'GUEST';
  }, [account, ownedObjects, ownedLoading]);

  const activeRole: ActiveRole = demoRole === 'AUTO' ? realRole : demoRole;

  // ─── Vendor Registration ────────────────────────────────────────────────────
  const [isRegistering, setIsRegistering] = useState(false);
  const handleRegisterVendor = async (name: string, desc: string) => {
    if (!account) return;
    setIsRegistering(true);
    try {
      // Note: In real production, this would require AdminCap or a specific permissioned call.
      // Here we assume a public registration or a mock for the demo.
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::alert::register_vendor`, // Adjust if name differs
        arguments: [
          tx.object('0x_ADMIN_CAP_PLACEHOLDER'), // This would need to be handled
          tx.object(VENDOR_REGISTRY_ID),
          tx.pure.string(name),
          tx.pure.string(desc),
          tx.pure.address(account.address),
        ],
      });
      console.log("Mocking Vendor Registration...");
      // For demo purposes, we might just "mock" the NFT if admin cap isn't available
      setTimeout(() => {
        setIsRegistering(false);
        setIsOnboarding(false);
        refetchOwned();
      }, 1500);
    } catch { setIsRegistering(false); }
  };

  // ─── Vendor List (enriched) ─────────────────────────────────────────────────
  // Build vendor list: from VendorRegistry object first, fall back to events
  const vendorList = useMemo((): VendorInfo[] => {
    // Build name map from VendorRegistered events
    const nameMap = new Map<string, string>();
    vendorEvents?.data.forEach(ev => {
      const { vendor, name } = ev.parsedJson as { vendor?: string; name?: string };
      if (vendor) nameMap.set(vendor, name || 'Unknown Vendor');
    });

    // Try to read from VendorRegistry object (has `vendors: VecSet<address>`)
    const content = vendorRegistryObj?.data?.content;
    if (content && 'fields' in content) {
      const fields = (content as { fields: Record<string, unknown> }).fields;
      const vendorsField = fields?.vendors;
      // VecSet<address> is stored as { contents: address[] }
      const addresses: string[] = (vendorsField as { contents?: string[] })?.contents || [];
      if (addresses.length > 0) {
        return addresses.map(addr => ({
          address: addr,
          name: nameMap.get(addr) || `Vendor ${addr.slice(0, 6)}…`,
        }));
      }
    }

    // Fallback: deduplicate from events
    const seen = new Set<string>();
    const vendors: VendorInfo[] = [];
    vendorEvents?.data.forEach(ev => {
      const { vendor, name } = ev.parsedJson as { vendor?: string; name?: string };
      if (vendor && !seen.has(vendor)) {
        seen.add(vendor);
        vendors.push({ address: vendor, name: name || 'Unknown Vendor' });
      }
    });
    return vendors;
  }, [vendorRegistryObj, vendorEvents]);

  // Parsed vulnerability alert events
  const parsedEvents = useMemo((): VulnAlertEvent[] => {
    return (events?.data || []).map(ev => {
      const j = ev.parsedJson as Record<string, unknown>;
      return {
        txDigest: ev.id.txDigest,
        vuln_id: j?.vuln_id as string | undefined,
        title: j?.title as string | undefined,
        description: j?.description as string | undefined,
        severity: j?.severity as number | undefined,
        blob_id: j?.blob_id as string | undefined,
        skill_blob_id: j?.skill_blob_id as string | undefined,
        vendor: j?.vendor as string | undefined,
      };
    });
  }, [events]);

  // ─── Subscription ───────────────────────────────────────────────────────────
  const [isMinting, setIsMinting] = useState(false);
  const handleSubscribe = async () => {
    if (!account) return;
    setIsMinting(true);
    try {
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [1000000000]);
      tx.moveCall({
        target: `${PACKAGE_ID}::alert::subscribe`,
        arguments: [
          tx.object(REGISTRY_ID),
          coin,
          tx.pure.string(account.address.slice(0, 8)),
          tx.object('0x6'), // Clock
        ],
      });
      signAndExecute(
        { transaction: tx },
        {
          onSuccess: () => { refetchOwned(); setIsMinting(false); },
          onError: () => setIsMinting(false),
        },
      );
    } catch { setIsMinting(false); }
  };

  // ─── Publish Skill (Vendor) ─────────────────────────────────────────────────
  const handlePublishSkill = async () => {
    if (activeRole !== 'VENDOR' || !account || !markdown || !vulnTitle) return;
    setPublishStep('encrypting');
    setPublishError(null);

    try {
      const vendorNft = ownedObjects?.data.find(o => o.data?.type?.includes('VendorNFT'))?.data?.objectId;
      if (!vendorNft) throw new Error('VendorNFT not found in wallet');

      // sealId = vendor's own address (stable, consistent with decrypt side)
      const vendorAddress = account.address;

      // 1. Encrypt + Upload to Walrus
      const { blobId } = await encryptAndUpload(
        markdown,
        PACKAGE_ID,
        vendorAddress,
        suiClient,
        (step) => {
          if (step.includes('Encrypt')) setPublishStep('encrypting');
          if (step.includes('Upload') || step.includes('Uploading')) setPublishStep('uploading');
        },
      );

      // 2. Write SkillBlob on-chain
      setPublishStep('publishing');
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::alert::publish_skill`,
        arguments: [
          tx.object(vendorNft),
          tx.pure.string(`VULN-${Date.now().toString().slice(-6)}`),
          tx.pure.string(vulnTitle),
          tx.pure.string(vulnDesc || 'No description provided.'),
          tx.pure.u8(severity),
          tx.pure.string(blobId),
          tx.object('0x6'), // Clock
        ],
      });

      signAndExecute(
        { transaction: tx },
        {
          onSuccess: () => {
            setPublishStep('done');
            setVulnTitle('');
            setVulnDesc('');
            setMarkdown("## [Skill] Patch...");
            setTimeout(() => setPublishStep('idle'), 3000);
          },
          onError: (err) => {
            setPublishError(err.message);
            setPublishStep('error');
          },
        },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setPublishError(msg);
      setPublishStep('error');
    }
  };

  // ─── View / Decrypt Skill (Subscriber / Vendor only) ────────────────────────
  const handleViewSkill = useCallback(async (blobId: string, vendorAddress: string, title: string) => {
    if (!account) return;
    // Only real SUBSCRIBER or VENDOR can decrypt (use realRole, not demo role)
    if (realRole === 'GUEST') return;

    setViewingSkill({ blobId, vendorAddress, title });
    setDecryptedContent(null);
    setDecryptError(null);
    setIsDecrypting(true);

    try {
      // Reuse cached SessionKey if still valid
      let sessionKey = sessionKeyRef.current;
      if (!sessionKey) {
        sessionKey = await createAndInitSessionKey(
          account.address,
          PACKAGE_ID,
          suiClient,
          signPersonalMessage,
        );
        sessionKeyRef.current = sessionKey;
      }

      const isVendor = realRole === 'VENDOR';
      const nftType = isVendor ? 'VendorNFT' : 'SubscriberNFT';
      const approveFunc = isVendor ? 'seal_approve_vendor' : 'seal_approve_subscriber';
      const nftId = ownedObjects?.data.find(o => o.data?.type?.includes(nftType))?.data?.objectId;
      if (!nftId) throw new Error(`${nftType} not found in wallet`);

      // vendorAddress is the Seal identity used during encryption
      const plaintext = await fetchAndDecrypt(
        blobId,
        vendorAddress,
        PACKAGE_ID,
        approveFunc,
        nftId,
        sessionKey,
        suiClient,
      );

      setDecryptedContent(plaintext);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Decryption failed';
      setDecryptError(msg);
      sessionKeyRef.current = null; // invalidate on error
    } finally {
      setIsDecrypting(false);
    }
  }, [account, realRole, ownedObjects, suiClient, signPersonalMessage]);

  const closeSkillModal = () => {
    setViewingSkill(null);
    setDecryptedContent(null);
    setDecryptError(null);
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-10 lg:p-12 font-sans selection:bg-primary/20 overflow-x-hidden">
      {/* Decorative Aurora */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10 space-y-8">

        {/* ── Demo Role Switcher ─────────────────────────────────────────── */}
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass neon-border p-2 rounded-2xl flex items-center gap-2 shadow-2xl"
        >
          <div className="px-3 flex items-center gap-2 border-r border-border/50 mr-2">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Demo UI</span>
          </div>
          {(['AUTO', 'VENDOR', 'SUBSCRIBER'] as const).map((role) => (
            <button
              key={role}
              onClick={() => setDemoRole(role)}
              className={`px-4 py-1.5 rounded-xl text-[10px] font-black transition-all ${demoRole === role
                ? role === 'AUTO' ? 'bg-primary text-white neon-border'
                  : role === 'VENDOR' ? 'bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                    : 'bg-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                : 'hover:bg-primary/10'
                }`}
            >
              {role === 'AUTO' ? 'AUTO (ON-CHAIN)' : role === 'VENDOR' ? 'PUBLISHER VIEW' : 'SUBSCRIBER VIEW'}
            </button>
          ))}
        </motion.div>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-6">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-1.5 bg-primary/20 rounded-lg neon-border">
                <ShieldCheck className="w-6 h-6 neon-text" />
              </div>
              <h1 className="text-2xl font-black tracking-tighter uppercase">
                SUI <span className="text-primary">IMMUNIZER</span>
              </h1>
            </div>
            <p className="text-[10px] text-muted-foreground font-bold tracking-widest uppercase flex items-center gap-2">
              <Globe className="w-3 h-3" /> Global Threat Response Network
              <Badge variant="outline" className="ml-2 border-primary/30 text-primary text-[8px] h-4">
                {activeRole}
              </Badge>
            </p>
          </motion.div>

          <div className="flex items-center gap-3">
            <ConnectButton
              connectText="🔗 Connect"
              className="wallet-connect-btn"
            />

            {(activeRole === 'VENDOR' || demoRole === 'VENDOR') ? (
              <Button
                onClick={() => setIsPublisherOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-500 neon-border font-bold rounded-xl h-10 px-4 flex items-center gap-2"
              >
                <ShieldPlus className="w-4 h-4" />
                <span>PUBLISH</span>
              </Button>
            ) : (
              <Button
                onClick={() => setIsOnboarding(true)}
                variant="outline"
                className="border-primary/50 text-primary hover:bg-primary/10 font-bold rounded-xl h-10 px-4 flex items-center gap-2"
              >
                <BadgePlus className="w-4 h-4" />
                <span>BECOME VENDOR</span>
              </Button>
            )}

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-3 glass px-3 py-2 rounded-xl border border-white/5"
            >
              <div className="text-right">
                <p className="text-[8px] uppercase tracking-widest text-muted-foreground font-black leading-none mb-1">Status</p>
                <p className={`font-black text-[10px] ${activeRole !== 'GUEST' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {activeRole !== 'GUEST' ? 'SECURE' : 'UNPROTECTED'}
                </p>
              </div>
              <div className="w-8 h-8 flex items-center justify-center relative">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                  className={`absolute inset-0 border rounded-full ${activeRole !== 'GUEST'
                    ? 'border-emerald-500/20 border-t-emerald-500'
                    : 'border-amber-500/20 border-t-amber-500'
                    }`}
                />
                {activeRole !== 'GUEST'
                  ? <Unlock className="w-4 h-4 text-emerald-500" />
                  : <Lock className="w-4 h-4 text-amber-500" />}
              </div>
            </motion.div>
          </div>
        </header>

        {/* ── Main Unified Content ────────────────────────────────────────── */}
        <div className="space-y-6">
          {activeRole === 'GUEST' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="glass border-amber-500/30 rounded-2xl overflow-hidden bg-amber-500/5"
            >
              <div className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-amber-500/10 rounded-xl flex-shrink-0">
                    <ShieldAlert className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm uppercase tracking-tight">System Unprotected</h3>
                    <p className="text-muted-foreground text-[10px] font-medium max-w-xl">
                      Subscribe to receive auto-healing &quot;Skills&quot; for verified threats.
                      Guests can browse the feed, but remediation guides are restricted.
                    </p>
                  </div>
                </div>
                {account && (
                  <Button onClick={handleSubscribe} size="sm" disabled={isMinting} className="bg-amber-500 hover:bg-amber-600 font-bold rounded-lg px-6 shadow-lg">
                    {isMinting ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : 'SUBSCRIBE (1 SUI)'}
                  </Button>
                )}
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3 space-y-6">
              <ThreatFeed
                events={parsedEvents}
                isLoading={eventsLoading}
                role={activeRole}
                onViewSkill={handleViewSkill}
                vendorList={vendorList}
              />
            </div>

            <div className="space-y-6">
              <Card className="glass neon-border overflow-hidden">
                <CardContent className="p-5 space-y-4">
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] border-b border-white/5 pb-2">Network Metrics</p>
                  <div className="grid grid-cols-1 gap-4">
                    {[
                      { label: 'Uptime', value: '99.9%', icon: Activity, color: 'text-blue-400' },
                      { label: 'Verified', value: String(vendorList.length), icon: Cpu, color: 'text-cyan-400' },
                      { label: 'Threats', value: String(parsedEvents.length), icon: Zap, color: 'text-yellow-400' },
                    ].map((stat) => (
                      <div key={stat.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <stat.icon className={`w-3 h-3 ${stat.color}`} />
                          <span className="text-[10px] font-bold text-muted-foreground">{stat.label}</span>
                        </div>
                        <span className="text-xs font-black">{stat.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <VendorDirectoryCard
                vendors={vendorList}
                isLoading={!mounted}
                onSelectVendor={setViewingVendor}
              />

              <AgentCapabilitiesCard />
            </div>
          </div>
        </div>
        {/* ── Publisher Modal ────────────────────────────────────────────── */}
        <AnimatePresence>
          {isPublisherOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-4xl max-h-[90vh] overflow-hidden"
              >
                <div className="relative">
                  <button
                    onClick={() => setIsPublisherOpen(false)}
                    className="absolute top-4 right-4 z-10 p-2 rounded-full hover:bg-white/10 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <VendorPublishCard
                    vulnTitle={vulnTitle}
                    setVulnTitle={setVulnTitle}
                    vulnDesc={vulnDesc}
                    setVulnDesc={setVulnDesc}
                    severity={severity}
                    setSeverity={setSeverity}
                    markdown={markdown}
                    setMarkdown={setMarkdown}
                    publishStep={publishStep}
                    publishError={publishError}
                    onPublish={handlePublishSkill}
                  />
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ── Onboarding Modal ──────────────────────────────────────────── */}
        <AnimatePresence>
          {isOnboarding && (
            <PublisherOnboardingModal
              onClose={() => setIsOnboarding(false)}
              onRegister={handleRegisterVendor}
              isRegistering={isRegistering}
            />
          )}
        </AnimatePresence>

        {/* ── Skill Viewer Modal ──────────────────────────────────────────── */}
        <AnimatePresence>
          {viewingSkill && (
            <SkillViewerModal
              skill={viewingSkill}
              isDecrypting={isDecrypting}
              content={decryptedContent}
              error={decryptError}
              onClose={closeSkillModal}
            />
          )}
        </AnimatePresence>

        {/* ── Vendor Detail Modal ─────────────────────────────────────────── */}
        <AnimatePresence>
          {viewingVendor && (
            <VendorDetailModal
              vendor={viewingVendor}
              allEvents={parsedEvents}
              role={activeRole}
              onViewSkill={handleViewSkill}
              onClose={() => setViewingVendor(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Vendor Publish Card ──────────────────────────────────────────────────────

interface VendorPublishCardProps {
  vulnTitle: string;
  setVulnTitle: (v: string) => void;
  vulnDesc: string;
  setVulnDesc: (v: string) => void;
  severity: number;
  setSeverity: (v: number) => void;
  markdown: string | undefined;
  setMarkdown: (v: string | undefined) => void;
  publishStep: PublishStep;
  publishError: string | null;
  onPublish: () => void;
}

function VendorPublishCard({
  vulnTitle,
  setVulnTitle,
  vulnDesc,
  setVulnDesc,
  severity,
  setSeverity,
  markdown,
  setMarkdown,
  publishStep,
  publishError,
  onPublish,
}: VendorPublishCardProps) {
  const isPublishing = ['encrypting', 'uploading', 'publishing'].includes(publishStep);
  const stepIndex = PUBLISH_STEPS.findIndex((s) => s.key === publishStep);

  return (
    <Card className="glass neon-border rounded-3xl overflow-hidden shadow-2xl">
      <CardHeader className="bg-primary/10 border-b border-border/50 p-6 flex flex-row items-center justify-between">
        <CardTitle className="text-xl font-bold flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary" /> PUBLISH VULNERABILITY SKILL (SEALED)
        </CardTitle>
        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
          Authorized Publisher
        </Badge>
      </CardHeader>
      <CardContent className="p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Vulnerability Title</label>
            <input
              type="text"
              placeholder="e.g. Remote Code Execution in XYZ"
              value={vulnTitle}
              onChange={(e) => setVulnTitle(e.target.value)}
              className="w-full bg-muted/20 border border-border/30 rounded-xl p-3 focus:outline-none focus:border-primary/50 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Severity (1-10)</label>
            <input
              type="range"
              min="1"
              max="10"
              value={severity}
              onChange={(e) => setSeverity(parseInt(e.target.value))}
              className="w-full accent-primary mt-2"
            />
            <div className="flex justify-between text-[10px] font-bold">
              <span>LOW</span>
              <span className="text-primary">{severity}</span>
              <span>CRITICAL</span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-muted-foreground uppercase">Short Description (Public — visible to all)</label>
          <input
            type="text"
            placeholder="Brief public summary visible to all users"
            value={vulnDesc}
            onChange={(e) => setVulnDesc(e.target.value)}
            className="w-full bg-muted/20 border border-border/30 rounded-xl p-3 focus:outline-none focus:border-primary/50 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-muted-foreground uppercase">
            Skill.md — <span className="text-primary">Encrypted with Seal (Subscribers-Only)</span>
          </label>
          <div className="rounded-xl overflow-hidden border border-border/30" data-color-mode="dark">
            <MDEditor value={markdown} onChange={setMarkdown} preview="edit" height={300} />
          </div>
        </div>

        {/* Progress Steps */}
        {publishStep !== 'idle' && (
          <div className="bg-muted/10 rounded-2xl p-4 space-y-3">
            {PUBLISH_STEPS.map((s, i) => {
              const isDone = publishStep === 'done' || i < stepIndex;
              const isActive = s.key === publishStep;
              const isFuture = !isDone && !isActive;
              return (
                <div key={s.key} className={`flex items-center gap-3 text-sm transition-all ${isFuture ? 'opacity-30' : ''}`}>
                  {isDone ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  ) : isActive ? (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-border/40" />
                  )}
                  <span className={isDone ? 'text-emerald-400' : isActive ? 'text-primary font-bold' : ''}>{s.label}</span>
                </div>
              );
            })}
            {publishStep === 'error' && publishError && <p className="text-red-400 text-xs mt-2 font-mono">{publishError}</p>}
          </div>
        )}

        <div className="flex justify-end pt-4">
          <Button
            onClick={onPublish}
            disabled={isPublishing || !vulnTitle || !markdown}
            className="bg-primary hover:bg-primary/80 neon-border font-bold rounded-xl px-12 h-12 text-base shadow-xl"
          >
            {isPublishing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> {PUBLISH_STEPS[stepIndex]?.label || 'Processing...'}
              </>
            ) : publishStep === 'done' ? (
              '✅ DEPLOYED!'
            ) : (
              '🔐 SEAL & DEPLOY SKILL'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Threat Feed ──────────────────────────────────────────────────────────────

interface ThreatFeedProps {
  events: VulnAlertEvent[];
  isLoading: boolean;
  role: ActiveRole;
  onViewSkill: (blobId: string, vendorAddress: string, title: string) => void;
  vendorList: VendorInfo[];
}

function ThreatFeed({ events, isLoading, role, onViewSkill, vendorList }: ThreatFeedProps) {
  return (
    <Card className="lg:col-span-2 glass border-border/50 rounded-3xl overflow-hidden shadow-2xl">
      <CardHeader className="bg-muted/30 border-b border-border/50 px-8 py-6">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" /> LIVE GLOBAL THREAT FEED
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex space-x-1">
              {[0, 1, 2].map((j) => (
                <div key={j} className="w-1 h-3 bg-primary rounded-full animate-pulse" />
              ))}
            </div>
            <span className="text-[10px] font-bold text-primary uppercase">On-Chain Events</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[500px]">
          <Table>
            <TableHeader className="bg-muted/10">
              <TableRow className="border-border/50">
                <TableHead className="px-8 py-4 text-[10px] font-bold uppercase text-muted-foreground">Vulnerability</TableHead>
                <TableHead className="px-4 py-4 text-[10px] font-bold uppercase text-muted-foreground">Publisher</TableHead>
                <TableHead className="px-4 py-4 text-[10px] font-bold uppercase text-muted-foreground">Severity</TableHead>
                <TableHead className="px-4 py-4 text-[10px] font-bold uppercase text-muted-foreground">Status</TableHead>
                <TableHead className="px-8 py-4 text-[10px] font-bold uppercase text-muted-foreground text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((ev) => {
                const canDecrypt = role !== 'GUEST' && !!ev.blob_id && !!ev.vendor;
                const vendorInfo = vendorList.find((v) => v.address === ev.vendor);
                const isVerified = !!vendorInfo;

                return (
                  <motion.tr
                    key={ev.txDigest}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`border-border/20 transition-colors ${isVerified ? 'verified-vendor-row' : 'hover:bg-muted/10'}`}
                  >
                    <TableCell className="px-8 py-5">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-mono text-[10px] font-bold text-primary">{ev.vuln_id || 'VULN'}</p>
                            {isVerified && <Badge className="verified-vendor-badge text-[8px] h-3 px-1 uppercase">Verified</Badge>}
                          </div>
                          <p className="text-sm font-semibold leading-tight mt-0.5">{ev.title || 'Security Skill'}</p>
                          {ev.description && (
                            <p className="text-[10px] text-muted-foreground truncate max-w-[200px] mt-0.5 italic opacity-60">{ev.description}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-5">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold truncate w-24">{vendorInfo?.name || 'Unknown'}</span>
                        <span className="text-[8px] font-mono text-muted-foreground truncate w-20">{ev.vendor}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-5">
                      <div className="flex space-x-0.5">
                        {Array.from({ length: 10 }).map((_, j) => (
                          <div
                            key={j}
                            className={`h-1 w-2 rounded-full ${j < (ev.severity || 0) ? 'bg-primary shadow-[0_0_5px_rgba(59,130,246,0.5)]' : 'bg-muted'}`}
                          />
                        ))}
                      </div>
                      <span className="text-[9px] text-muted-foreground mt-1 block">{ev.severity}/10</span>
                    </TableCell>
                    <TableCell className="px-4 py-5">
                      <Badge
                        variant="outline"
                        className={`text-[9px] font-black uppercase ${role !== 'GUEST' ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-400'
                          }`}
                      >
                        {role !== 'GUEST' ? 'PROTECTED' : 'LOCKED'}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-8 py-5 text-right">
                      {canDecrypt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onViewSkill(ev.blob_id!, ev.vendor!, ev.title || 'Skill')}
                          className="text-[10px] font-bold hover:text-primary transition-all group flex items-center ml-auto gap-2"
                        >
                          <Eye className="w-3 h-3" /> VIEW SKILL
                        </Button>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5 text-muted-foreground">
                          <Lock className="w-3 h-3" />
                          <span className="text-[9px] uppercase font-bold">Subscribe</span>
                        </div>
                      )}
                    </TableCell>
                  </motion.tr>
                );
              })}
              {isLoading && (
                <TableRow className="border-border/20 opacity-50">
                  <TableCell
                    colSpan={5}
                    className="px-8 py-10 text-center animate-pulse text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Scanning chain for threats...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && events.length === 0 && (
                <TableRow className="border-border/20">
                  <TableCell colSpan={5} className="px-8 py-10 text-center text-xs text-muted-foreground italic">
                    No vulnerability alerts found. The network is quiet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ─── Vendor Directory Card ────────────────────────────────────────────────────

interface VendorDirectoryCardProps {
  vendors: VendorInfo[];
  isLoading: boolean;
  onSelectVendor: (vendor: VendorInfo) => void;
}

function VendorDirectoryCard({ vendors, isLoading, onSelectVendor }: VendorDirectoryCardProps) {
  return (
    <Card className="glass neon-border rounded-3xl overflow-hidden shadow-2xl">
      <CardHeader className="bg-primary/5 border-b border-border/50 p-6">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> TRUSTED PUBLISHERS
          <Badge variant="outline" className="ml-auto text-[9px] border-primary/20 text-primary">
            {vendors.length} on-chain
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="space-y-2">
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {vendors.map((v) => (
            <button
              key={v.address}
              onClick={() => onSelectVendor(v)}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-muted/10 border border-border/20 group hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center font-bold text-xs text-primary flex-shrink-0">
                  {v.name?.[0]?.toUpperCase() || 'V'}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold leading-none mb-1 truncate">{v.name}</p>
                  <p className="text-[9px] font-mono text-muted-foreground truncate w-28">{v.address}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge className="bg-emerald-500/10 text-emerald-400 text-[8px] border-none uppercase">Verified</Badge>
                <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </button>
          ))}
          {!isLoading && vendors.length === 0 && (
            <p className="text-[10px] text-center py-6 text-muted-foreground italic">No publishers registered yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Vendor Detail Modal ──────────────────────────────────────────────────────

interface VendorDetailModalProps {
  vendor: VendorInfo;
  allEvents: VulnAlertEvent[];
  role: ActiveRole;
  onViewSkill: (blobId: string, vendorAddress: string, title: string) => void;
  onClose: () => void;
}

function VendorDetailModal({ vendor, allEvents, role, onViewSkill, onClose }: VendorDetailModalProps) {
  const vendorSkills = allEvents.filter((ev) => ev.vendor === vendor.address);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass neon-border rounded-3xl overflow-hidden w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-border/50 bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-xl">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-black text-base">{vendor.name}</h3>
              <p className="text-[10px] font-mono text-muted-foreground">{vendor.address}</p>
            </div>
            <Badge className="bg-emerald-500/10 text-emerald-400 text-[8px] border-none uppercase ml-2">Verified Publisher</Badge>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted/30 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Published Skills</h4>
              <Badge variant="outline" className="text-[9px] border-border/30">
                {vendorSkills.length} total
              </Badge>
            </div>

            {vendorSkills.length === 0 && (
              <div className="text-center py-10 text-muted-foreground">
                <Shield className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-xs italic">No skills published by this vendor yet.</p>
              </div>
            )}

            {vendorSkills.map((skill) => (
              <div
                key={skill.txDigest}
                className="p-4 rounded-2xl bg-muted/10 border border-border/20 hover:border-primary/20 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[10px] text-primary font-bold">{skill.vuln_id || 'VULN'}</span>
                      <div className="flex space-x-0.5">
                        {Array.from({ length: 10 }).map((_, j) => (
                          <div key={j} className={`h-1 w-1.5 rounded-full ${j < (skill.severity || 0) ? 'bg-primary' : 'bg-muted'}`} />
                        ))}
                      </div>
                      <span className="text-[9px] text-muted-foreground">{skill.severity}/10</span>
                    </div>
                    <p className="font-semibold text-sm leading-tight">{skill.title || 'Unknown Vulnerability'}</p>
                    {skill.description && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{skill.description}</p>}
                  </div>

                  <div className="flex-shrink-0">
                    {role !== 'GUEST' && skill.blob_id && skill.vendor ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          onClose();
                          onViewSkill(skill.blob_id!, skill.vendor!, skill.title || 'Skill');
                        }}
                        className="text-[10px] font-bold border-primary/30 hover:bg-primary/10 flex items-center gap-1.5"
                      >
                        <Eye className="w-3 h-3" />
                        VIEW SKILL
                      </Button>
                    ) : role === 'GUEST' ? (
                      <div className="flex flex-col items-center gap-1">
                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                          <Lock className="w-4 h-4 text-amber-500" />
                        </div>
                        <span className="text-[8px] text-muted-foreground uppercase">Subscribe</span>
                      </div>
                    ) : (
                      <div className="p-2 rounded-lg bg-muted/20">
                        <ExternalLink className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-border/50 bg-muted/10 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <span className="text-[10px] text-muted-foreground">
            Skill content is <span className="text-primary font-bold">Seal-encrypted</span> on Walrus.
            {role === 'GUEST' && ' Subscribe to unlock full skill details and remediation guides.'}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Agent Capabilities Card ──────────────────────────────────────────────────

function AgentCapabilitiesCard() {
  return (
    <Card className="glass neon-border rounded-3xl overflow-hidden shadow-2xl">
      <CardHeader className="bg-primary/5 border-b border-border/50 p-6">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Search className="w-4 h-4 text-primary" /> AGENT CAPABILITIES
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <ul className="space-y-4">
          {[
            { title: 'Sui Event Watcher', desc: 'Real-time vulnerability detection from on-chain events' },
            { title: 'Seal Decryption', desc: 'SessionKey-based, no repeated wallet interactions' },
            { title: 'Walrus Blob Fetch', desc: 'Fetch encrypted skill payloads from decentralized storage' },
            { title: 'OpenClaw AI Execution', desc: 'Automated patch application via embedded AI agent' },
          ].map((item, i) => (
            <li key={i} className="flex gap-3">
              <div className="mt-1 flex-shrink-0 w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              </div>
              <div>
                <p className="text-xs font-bold leading-none mb-1">{item.title}</p>
                <p className="text-[10px] text-muted-foreground">{item.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Skill Viewer Modal ───────────────────────────────────────────────────────

interface SkillViewerModalProps {
  skill: { blobId: string; vendorAddress: string; title: string };
  isDecrypting: boolean;
  content: string | null;
  error: string | null;
  onClose: () => void;
}

function SkillViewerModal({ skill, isDecrypting, content, error, onClose }: SkillViewerModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass neon-border rounded-3xl overflow-hidden w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-border/50 bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-xl">
              <Fingerprint className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-black text-base">{skill.title}</h3>
              <p className="text-[10px] font-mono text-muted-foreground truncate max-w-xs">blob: {skill.blobId}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted/30 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6">
            {isDecrypting && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Requesting Seal decryption keys...</p>
                <p className="text-[10px] text-muted-foreground">Please sign the session key in your wallet</p>
              </div>
            )}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
                <p className="text-red-400 text-sm font-mono">{error}</p>
              </div>
            )}
            {content && (
              <div data-color-mode="dark">
                <MarkdownPreview source={content} className="!bg-transparent" />
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-border/50 bg-muted/10 flex items-center gap-2">
          <Lock className="w-4 h-4 text-primary" />
          <span className="text-[10px] text-muted-foreground">
            Content protected by <span className="text-primary font-bold">Seal Threshold Encryption</span> — Walrus blob:{' '}
            <code className="text-[9px]">{skill.blobId}</code>
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Publisher Onboarding Modal ────────────────────────────────────────────────

interface PublisherOnboardingModalProps {
  onClose: () => void;
  onRegister: (name: string, desc: string) => void;
  isRegistering: boolean;
}

function PublisherOnboardingModal({ onClose, onRegister, isRegistering }: PublisherOnboardingModalProps) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass neon-border rounded-3xl p-8 w-full max-w-md space-y-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-primary/20 rounded-2xl mb-2">
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-black tracking-tight italic uppercase">Join Global Response</h2>
          <p className="text-muted-foreground text-xs font-medium">Register your security entity to publish patch skills.</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest pl-1">Vendor Name</label>
            <input
              type="text"
              placeholder="e.g. Immunizer Labs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-muted/20 border border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest pl-1">Capability Description</label>
            <textarea
              placeholder="Brief overview of your security expertise..."
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              className="w-full bg-muted/20 border border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-primary/50 resize-none"
            />
          </div>
        </div>

        <div className="pt-2">
          <Button
            onClick={() => onRegister(name, desc)}
            disabled={!name || !desc || isRegistering}
            className="w-full bg-primary hover:bg-primary/80 neon-border font-bold rounded-xl h-12 text-sm shadow-xl"
          >
            {isRegistering ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowUpRight className="w-4 h-4 mr-2" />}
            {isRegistering ? 'REGISTERING...' : 'REGISTER ON-CHAIN'}
          </Button>
          <p className="text-[9px] text-center text-muted-foreground mt-4 font-bold uppercase tracking-tighter opacity-50">
            * Registration requires Admin Approval in this demo.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
