'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
  X
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

// ─── Publish Steps ────────────────────────────────────────────────────────────
type PublishStep = 'idle' | 'encrypting' | 'uploading' | 'publishing' | 'done' | 'error';

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

  // Decrypt / View Skill state
  const [viewingSkill, setViewingSkill] = useState<{ blobId: string; objectId: string; title: string } | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const sessionKeyRef = useRef<SessionKey | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // ─── Live Chain Queries ─────────────────────────────────────────────────────
  const { data: events, isLoading: eventsLoading } = useSuiClientQuery('queryEvents', {
    query: { MoveModule: { package: PACKAGE_ID, module: 'alert' } },
    limit: 20,
    order: 'descending',
  });

  const { data: vendorEvents } = useSuiClientQuery('queryEvents', {
    query: { MoveEventType: `${PACKAGE_ID}::alert::VendorRegistered` },
    limit: 10,
    order: 'descending',
  });

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
  const realRole = useMemo(() => {
    if (!account) return 'GUEST';
    if (ownedLoading || !ownedObjects) return 'GUEST';
    const hasVendor = ownedObjects.data.some(o => o.data?.type?.includes('VendorNFT'));
    const hasSub = ownedObjects.data.some(o => o.data?.type?.includes('SubscriberNFT'));
    if (hasVendor) return 'VENDOR';
    if (hasSub) return 'SUBSCRIBER';
    return 'GUEST';
  }, [account, ownedObjects, ownedLoading]);

  const activeRole = demoRole === 'AUTO' ? realRole : demoRole;

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

      // We'll use the vendorNft objectId as the Seal identity (deterministic per vendor+skill)
      // In a production setup you'd derive a unique ID per skill blob
      const sealId = vendorNft;

      // 1. Encrypt + Upload to Walrus
      const { blobId } = await encryptAndUpload(
        markdown,
        PACKAGE_ID,
        sealId,
        suiClient,
        (step) => {
          if (step.includes('Encrypt')) setPublishStep('encrypting');
          if (step.includes('Upload')) setPublishStep('uploading');
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

  // ─── View / Decrypt Skill (Subscriber / Vendor) ─────────────────────────────
  const handleViewSkill = async (blobId: string, sealId: string, title: string) => {
    if (!account) return;
    setViewingSkill({ blobId, objectId: sealId, title });
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

      const plaintext = await fetchAndDecrypt(
        blobId,
        sealId,
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
  };

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
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-border/50 pb-8">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-primary/20 rounded-xl neon-border">
                <ShieldCheck className="w-8 h-8 neon-text" />
              </div>
              <h1 className="text-4xl font-black tracking-tighter">
                SUI <span className="text-primary">IMMUNIZER</span>
              </h1>
            </div>
            <p className="text-muted-foreground font-medium flex items-center gap-2">
              <Globe className="w-4 h-4" /> Global Threat Response Network
              <Badge variant="outline" className="ml-2 border-primary/30 text-primary uppercase text-[10px]">
                Active UI: {activeRole}
              </Badge>
            </p>
          </motion.div>

          <div className="flex items-center gap-4">
            {/* Slush-first wallet connect button */}
            <ConnectButton />

            {activeRole === 'GUEST' && account && (
              <Button
                onClick={handleSubscribe}
                className="bg-primary hover:bg-primary/80 neon-border font-bold rounded-xl flex items-center gap-2"
                disabled={isMinting}
              >
                <Coins className="w-4 h-4" />
                {isMinting ? 'WAITING...' : 'PAY 1 SUI TO PROTECT'}
              </Button>
            )}

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-4 glass p-4 rounded-2xl neon-border"
            >
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold leading-none mb-1">Protection Status</p>
                <p className={`font-black text-xs ${activeRole !== 'GUEST' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {activeRole !== 'GUEST' ? 'IMMUNIZED' : 'VULNERABLE'}
                </p>
              </div>
              <div className="w-10 h-10 flex items-center justify-center relative">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                  className={`absolute inset-0 border-2 rounded-full ${activeRole !== 'GUEST'
                    ? 'border-emerald-500/30 border-t-emerald-500'
                    : 'border-amber-500/30 border-t-amber-500'
                    }`}
                />
                {activeRole !== 'GUEST'
                  ? <Unlock className="w-5 h-5 text-emerald-500" />
                  : <Lock className="w-5 h-5 text-amber-500" />}
              </div>
            </motion.div>
          </div>
        </header>

        {/* ── Role-Based Views ───────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {activeRole === 'VENDOR' ? (
            <motion.div
              key="vendor"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
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
              <ThreatFeed
                events={events}
                isLoading={eventsLoading}
                role={activeRole}
                onViewSkill={handleViewSkill}
              />
            </motion.div>
          ) : (
            <motion.div
              key="subscriber"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {activeRole === 'GUEST' && (
                <Card className="glass border-amber-500/50 rounded-3xl overflow-hidden bg-amber-500/5">
                  <CardContent className="p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-6">
                      <div className="p-4 bg-amber-500/20 rounded-2xl">
                        <ShieldAlert className="w-10 h-10 text-amber-500" />
                      </div>
                      <div>
                        <h3 className="font-black text-2xl tracking-tight">PROTECTION DISABLED</h3>
                        <p className="text-muted-foreground max-w-md">
                          Your system is not connected to the Global Threat Response Network.
                          Subscribe to receive auto-healing &quot;Skills&quot; for verified vulnerabilities.
                        </p>
                      </div>
                    </div>
                    {account && (
                      <Button onClick={handleSubscribe} size="lg" className="bg-amber-500 hover:bg-amber-600 font-bold rounded-xl px-10 h-14 shadow-2xl">
                        SUBSCRIBE NOW (1 SUI)
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: 'Network Uptime', value: '99.99%', icon: Activity, color: 'text-blue-400' },
                  { label: 'Verified Publishers', value: String(vendorEvents?.data.length || '0'), icon: Cpu, color: 'text-cyan-400' },
                  { label: 'Skills Available', value: String(events?.data.length || '0'), icon: Zap, color: 'text-yellow-400' },
                  { label: 'System Health', value: activeRole !== 'GUEST' ? 'SECURE' : 'UNDETECTED', icon: AlertTriangle, color: activeRole !== 'GUEST' ? 'text-emerald-400' : 'text-amber-400' },
                ].map((stat) => (
                  <Card key={stat.label} className="glass neon-border overflow-hidden group">
                    <CardContent className="p-6 relative">
                      <stat.icon className={`absolute -right-4 -bottom-4 w-24 h-24 opacity-5 group-hover:opacity-10 transition-opacity ${stat.color}`} />
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">{stat.label}</p>
                      <h3 className="text-3xl font-black">{stat.value}</h3>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <ThreatFeed
                  events={events}
                  isLoading={eventsLoading}
                  role={activeRole}
                  onViewSkill={handleViewSkill}
                />
                <div className="space-y-6">
                  <VendorDirectoryCard vendorEvents={vendorEvents} />
                  <AgentCapabilitiesCard />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
    </div>
  );
}

// ─── Vendor Publish Card ──────────────────────────────────────────────────────

interface VendorPublishCardProps {
  vulnTitle: string; setVulnTitle: (v: string) => void;
  vulnDesc: string; setVulnDesc: (v: string) => void;
  severity: number; setSeverity: (v: number) => void;
  markdown: string | undefined; setMarkdown: (v: string | undefined) => void;
  publishStep: PublishStep;
  publishError: string | null;
  onPublish: () => void;
}

function VendorPublishCard({
  vulnTitle, setVulnTitle, vulnDesc, setVulnDesc,
  severity, setSeverity, markdown, setMarkdown,
  publishStep, publishError, onPublish,
}: VendorPublishCardProps) {
  const isPublishing = ['encrypting', 'uploading', 'publishing'].includes(publishStep);

  const stepIndex = PUBLISH_STEPS.findIndex(s => s.key === publishStep);

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
              type="range" min="1" max="10"
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
          <label className="text-xs font-bold text-muted-foreground uppercase">Short Description (Public)</label>
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
            <MDEditor
              value={markdown}
              onChange={setMarkdown}
              preview="edit"
              height={300}
            />
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
                  {isDone
                    ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                    : isActive
                      ? <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      : <div className="w-4 h-4 rounded-full border border-border/40" />}
                  <span className={isDone ? 'text-emerald-400' : isActive ? 'text-primary font-bold' : ''}>
                    {s.label}
                  </span>
                </div>
              );
            })}
            {publishStep === 'error' && publishError && (
              <p className="text-red-400 text-xs mt-2 font-mono">{publishError}</p>
            )}
          </div>
        )}

        <div className="flex justify-end pt-4">
          <Button
            onClick={onPublish}
            disabled={isPublishing || !vulnTitle || !markdown}
            className="bg-primary hover:bg-primary/80 neon-border font-bold rounded-xl px-12 h-12 text-base shadow-xl"
          >
            {isPublishing
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {PUBLISH_STEPS[stepIndex]?.label || 'Processing...'}</>
              : publishStep === 'done' ? '✅ DEPLOYED!'
                : '🔐 SEAL & DEPLOY SKILL'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Threat Feed ──────────────────────────────────────────────────────────────

interface ThreatFeedProps {
  events: { data: Array<{ id: { txDigest: string }; parsedJson: unknown }> } | undefined;
  isLoading: boolean;
  role: string;
  onViewSkill: (blobId: string, objectId: string, title: string) => void;
}

function ThreatFeed({ events, isLoading, role, onViewSkill }: ThreatFeedProps) {
  return (
    <Card className="lg:col-span-2 glass border-border/50 rounded-3xl overflow-hidden shadow-2xl">
      <CardHeader className="bg-muted/30 border-b border-border/50 px-8 py-6">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" /> LIVE GLOBAL THREAT FEED
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex space-x-1">
              {[0, 1, 2].map(j => <div key={j} className="w-1 h-3 bg-primary rounded-full animate-pulse" />)}
            </div>
            <span className="text-[10px] font-bold text-primary uppercase">Listening for Vaccine Blobs...</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[500px]">
          <Table>
            <TableHeader className="bg-muted/10">
              <TableRow className="border-border/50">
                <TableHead className="px-8 py-4 text-[10px] font-bold uppercase text-muted-foreground">Vulnerability</TableHead>
                <TableHead className="px-8 py-4 text-[10px] font-bold uppercase text-muted-foreground">Severity</TableHead>
                <TableHead className="px-8 py-4 text-[10px] font-bold uppercase text-muted-foreground">Status</TableHead>
                <TableHead className="px-8 py-4 text-[10px] font-bold uppercase text-muted-foreground text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="popLayout">
                {events?.data.map((ev) => {
                  const { vuln_id, title, severity, blob_id, skill_blob_id } =
                    (ev.parsedJson as { vuln_id?: string; title?: string; severity?: number; blob_id?: string; skill_blob_id?: string }) || {};
                  const canView = role !== 'GUEST' && blob_id;
                  return (
                    <motion.tr
                      key={ev.id.txDigest}
                      initial={{ opacity: 0, backgroundColor: 'rgba(59,130,246,0.1)' }}
                      animate={{ opacity: 1, backgroundColor: 'transparent' }}
                      className="border-border/20 hover:bg-muted/20 transition-colors"
                    >
                      <TableCell className="px-8 py-5">
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="font-mono text-xs font-bold text-primary">{vuln_id || 'UNKNOWN'}</p>
                            <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{title || 'Critical Security Patch'}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-8 py-5">
                        <div className="flex space-x-0.5">
                          {Array.from({ length: 10 }).map((_, j) => (
                            <div key={j} className={`h-1 w-2 rounded-full ${j < (severity || 0) ? 'bg-primary shadow-[0_0_5px_rgba(59,130,246,0.5)]' : 'bg-muted'}`} />
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="px-8 py-5">
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-black uppercase ${role !== 'GUEST' ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-400'
                            }`}
                        >
                          {role !== 'GUEST' ? 'PROTECTED' : 'LOCKED'}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-8 py-5 text-right">
                        {canView ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onViewSkill(blob_id!, skill_blob_id || '', title || 'Skill')}
                            className="text-[10px] font-bold hover:text-primary transition-all group flex items-center ml-auto gap-2"
                          >
                            <Eye className="w-3 h-3" /> VIEW SKILL
                          </Button>
                        ) : (
                          <Lock className="w-3 h-3 text-muted-foreground ml-auto" />
                        )}
                      </TableCell>
                    </motion.tr>
                  );
                })}
                {isLoading && [1, 2, 3].map(i => (
                  <TableRow key={i} className="border-border/20 opacity-50">
                    <TableCell colSpan={4} className="px-8 py-10 text-center animate-pulse text-xs uppercase tracking-widest text-muted-foreground">
                      Searching network for new vaccines...
                    </TableCell>
                  </TableRow>
                ))}
              </AnimatePresence>
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ─── Vendor Directory Card ────────────────────────────────────────────────────

function VendorDirectoryCard({ vendorEvents }: { vendorEvents: { data: Array<{ parsedJson: unknown }> } | undefined }) {
  return (
    <Card className="glass neon-border rounded-3xl overflow-hidden shadow-2xl">
      <CardHeader className="bg-primary/5 border-b border-border/50 p-6">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> TRUSTED PUBLISHERS
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="space-y-4">
          {vendorEvents?.data.map((ev, i) => {
            const { name, vendor } = ev.parsedJson as { name?: string; vendor?: string };
            return (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-muted/10 border border-border/20 group hover:border-primary/30 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center font-bold text-xs text-primary">
                    {name?.[0] || 'V'}
                  </div>
                  <div>
                    <p className="text-xs font-bold leading-none mb-1">{name || 'Unnamed Vendor'}</p>
                    <p className="text-[9px] font-mono text-muted-foreground truncate w-24">{vendor}</p>
                  </div>
                </div>
                <Badge className="bg-emerald-500/10 text-emerald-400 text-[8px] border-none uppercase">Verified</Badge>
              </div>
            );
          })}
          {(!vendorEvents || vendorEvents.data.length === 0) && (
            <p className="text-[10px] text-center py-4 text-muted-foreground italic">No publishers registered yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
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
            { title: 'Sui Event Watcher', desc: 'Real-time vulnerability detection' },
            { title: 'Seal Decryption', desc: 'Private-key SessionKey, no wallet interaction' },
            { title: 'Walrus Blob Fetch', desc: 'Download encrypted skill payloads' },
            { title: 'Skill Execution Engine', desc: 'Automated patch application' },
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
  skill: { blobId: string; objectId: string; title: string };
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
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-border/50 bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-xl">
              <Fingerprint className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-black text-base">{skill.title}</h3>
              <p className="text-[10px] font-mono text-muted-foreground truncate max-w-xs">{skill.blobId}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted/30 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
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

        {/* Seal Badge */}
        <div className="p-4 border-t border-border/50 bg-muted/10 flex items-center gap-2">
          <Lock className="w-4 h-4 text-primary" />
          <span className="text-[10px] text-muted-foreground">
            Content protected by <span className="text-primary font-bold">Seal Threshold Encryption</span> — Walrus blob: <code className="text-[9px]">{skill.blobId}</code>
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
