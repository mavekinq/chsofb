import { motion, AnimatePresence } from "framer-motion";

interface SplashScreenProps {
  isVisible: boolean;
}

const particles = [
  { left: "18%", top: "24%", delay: -1 },
  { left: "78%", top: "28%", delay: -4 },
  { left: "25%", top: "72%", delay: -2 },
  { left: "82%", top: "68%", delay: -5 },
  { left: "50%", top: "15%", delay: -3 },
];

const SplashScreen = ({ isVisible }: SplashScreenProps) => (
  <AnimatePresence>
    {isVisible && (
      <motion.div
        role="status"
        aria-label="Çelebi OFB yükleniyor"
        className="celebi-splash fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-[#08131f] text-white"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, scale: 1.02 }}
        transition={{ duration: 0.55 }}
      >
        <style>{`
          @keyframes celebi-grid { to { background-position: 52px 52px; } }
          @keyframes celebi-breathe { 50% { transform: scale(1.18); opacity: .6; } }
          @keyframes celebi-float { 50% { transform: translateY(-7px); } }
          @keyframes celebi-ring { 50% { transform: scale(1.04); opacity: .45; } }
          @keyframes celebi-spin { to { transform: rotate(360deg); } }
          @keyframes celebi-scan { 0%,100% { top: -45%; } 50% { top: 110%; } }
          @keyframes celebi-twinkle { 0%,100% { transform: translateY(0) scale(.7); opacity: .25; } 50% { transform: translateY(-18px) scale(1.35); opacity: 1; } }
          @keyframes celebi-progress { 0% { transform: translateX(-110%); } 55% { transform: translateX(90%); } 100% { transform: translateX(310%); } }
          @keyframes celebi-shimmer { to { background-position: 200% 0; } }
          @media (prefers-reduced-motion: reduce) { .celebi-splash *, .celebi-splash *::before, .celebi-splash *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }
        `}</style>

        <div
          className="pointer-events-none absolute inset-0 opacity-[.14] [background-image:linear-gradient(#69829a22_1px,transparent_1px),linear-gradient(90deg,#69829a22_1px,transparent_1px)] [background-size:52px_52px] [mask-image:radial-gradient(ellipse_at_center,#000_0%,transparent_72%)]"
          style={{ animation: "celebi-grid 22s linear infinite" }}
        />
        <div
          className="pointer-events-none absolute h-[380px] w-[380px] rounded-full bg-sky-600/10 blur-[80px]"
          style={{ animation: "celebi-breathe 4s ease-in-out infinite" }}
        />
        <div
          className="pointer-events-none absolute h-[min(76vw,420px)] w-[min(76vw,420px)] rounded-full border border-sky-200/[.07]"
          style={{ animation: "celebi-spin 32s linear infinite" }}
        >
          <span className="absolute left-[17%] top-[13%] h-[5px] w-[5px] rounded-full bg-sky-200 shadow-[0_0_14px_4px_#46b7f088]" />
          <span className="absolute bottom-[29%] right-[7%] h-[3px] w-[3px] rounded-full bg-sky-200 shadow-[0_0_14px_4px_#46b7f088]" />
        </div>

        <div className="pointer-events-none absolute inset-0">
          {particles.map((particle, index) => (
            <span
              key={index}
              className="absolute h-[3px] w-[3px] rounded-full bg-sky-100 shadow-[0_0_12px_2px_#56bfff]"
              style={{
                left: particle.left,
                top: particle.top,
                animation: `celebi-twinkle 7s ${particle.delay}s ease-in-out infinite`,
              }}
            />
          ))}
        </div>

        <motion.main
          className="relative flex w-[min(92vw,440px)] flex-col items-center text-center"
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <motion.div
            className="relative grid h-[116px] w-[116px] place-items-center rounded-[32px] border border-sky-200/25 bg-gradient-to-br from-[#18334b] to-[#0c1e2d] p-4 shadow-[0_20px_65px_#0007,inset_0_1px_#ffffff16]"
            animate={{ y: [0, -7, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute -inset-[7px] rounded-[38px] border border-sky-300/20"
              animate={{ scale: [1, 1.04, 1], opacity: [0.8, 0.35, 0.8] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute -inset-[18px] rounded-full"
              style={{
                background: "conic-gradient(from 0deg, transparent 0 72%, #69d7ff 82%, #ffffffaa 85%, transparent 91%)",
                mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))",
                WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))",
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
            />
            <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[32px]">
              <motion.span
                className="absolute left-0 right-0 h-[38%] bg-gradient-to-b from-transparent via-sky-200/20 to-transparent"
                animate={{ top: ["-45%", "110%", "-45%"] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              />
            </span>
            <motion.img
              src="/celebi-logo.png"
              alt="Çelebi"
              className="relative z-10 max-h-full max-w-full object-contain drop-shadow-[0_4px_10px_#07172488]"
              initial={{ scale: 0.75, rotate: -8, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.15, type: "spring", bounce: 0.35 }}
            />
          </motion.div>

          <motion.h1
            className="mb-0 mt-[34px] text-[28px] font-bold tracking-[.045em] sm:text-4xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.55 }}
          >
            Çelebi <span className="text-[#e8b45c]">OFB</span>
          </motion.h1>
          <motion.p
            className="mt-2 text-[11px] uppercase tracking-[.25em] text-[#9fb2c4]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            Operations Flight Board
          </motion.p>

          <motion.div
            className="mt-[42px] flex items-center gap-2.5 text-sm tracking-[.015em] text-[#c3d0dc]"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.5 }}
          >
            <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-sky-300 shadow-[0_0_13px_#59c5ed]" />
            <span>Veriler hazırlanıyor...</span>
          </motion.div>

          <div
            className="mt-[17px] h-[3px] w-[210px] overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label="Yükleniyor"
          >
            <div
              className="h-full w-[36%] rounded-full bg-gradient-to-r from-sky-600 via-sky-200 to-white shadow-[0_0_12px_#47b4ebaa]"
              style={{
                backgroundSize: "200% 100%",
                animation: "celebi-progress 2.1s ease-in-out infinite, celebi-shimmer 1.3s linear infinite",
              }}
            />
          </div>
        </motion.main>

        <motion.p
          className="absolute bottom-7 text-[10px] uppercase tracking-[.16em] text-[#718397]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.6 }}
        >
          Uçuş operasyonları <span className="px-1.5 text-sky-400">•</span> Canlı takip
        </motion.p>
      </motion.div>
    )}
  </AnimatePresence>
);

export default SplashScreen;
