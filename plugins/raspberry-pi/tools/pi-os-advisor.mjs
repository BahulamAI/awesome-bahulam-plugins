import { resolveState, resolveBoardRam, recordAdvisory } from './lib.mjs';
import { resolveSpec } from './board-specs.mjs';

const WORKLOADS = ['headless-server', 'home-assistant', 'media-center', 'kiosk', 'desktop'];
const BOOT_MEDIA_PREFS = ['sd', 'nvme', 'auto'];

const NVME_CAVEAT = 'NVMe requires a separate M.2 HAT — the PCIe 2.0 x1 interface on Pi 5 is not usable for storage without one.';

function resolveBootMedia(pref, workload, ramGb) {
  if (pref === 'sd' || pref === 'nvme') return pref;
  const ioHeavy = workload === 'home-assistant' || workload === 'media-center';
  return (ioHeavy || ramGb >= 8) ? 'nvme' : 'sd';
}

function recommendImage(workload) {
  switch (workload) {
    case 'headless-server':
      return {
        image: 'Raspberry Pi OS Lite (64-bit)',
        alternative: 'Ubuntu Server 64-bit LTS',
        notes: ['No desktop environment — smallest footprint, most RAM free for services.'],
      };
    case 'home-assistant':
      return {
        image: 'Home Assistant OS (HAOS) — turnkey appliance, easiest to maintain',
        alternative: 'Raspberry Pi OS Lite (64-bit) + Home Assistant Container, if you want the Pi to stay general-purpose alongside other services',
        notes: ['HAOS takes over the whole boot device; the container route shares the OS with other workloads but needs more manual maintenance.'],
      };
    case 'media-center':
      return {
        image: 'Raspberry Pi OS Lite (64-bit) + Jellyfin, or a dedicated Kodi image (LibreELEC/CoreELEC-style)',
        alternative: null,
        notes: ['Pi 5\'s 4Kp60 HEVC decoder and dual 4Kp60 HDMI output cover most local transcode-free playback needs.'],
      };
    case 'kiosk':
      return {
        image: 'Raspberry Pi OS Lite (64-bit) + Chromium in kiosk mode',
        alternative: null,
        notes: ['A minimal Wayland/X compositor plus autostart is usually enough — a full desktop image is unnecessary overhead.'],
      };
    default:
      return {
        image: 'Raspberry Pi OS (Desktop, 64-bit)',
        alternative: null,
        notes: ['Full desktop experience; VideoCore VII covers OpenGL ES 3.1 / Vulkan 1.2 workloads.'],
      };
  }
}

export async function call(args = {}, options = {}) {
  const state = await resolveState(options);
  const workload = WORKLOADS.includes(args.workload) ? args.workload : 'headless-server';
  const bootMediaPref = BOOT_MEDIA_PREFS.includes(args.boot_media_pref) ? args.boot_media_pref : 'auto';
  const { board, ramGb } = resolveBoardRam(state, args);

  const spec = resolveSpec(ramGb);
  const { image, alternative, notes } = recommendImage(workload);
  const bootMedia = resolveBootMedia(bootMediaPref, workload, ramGb);

  const configTweaks = [];
  if (workload === 'headless-server' || workload === 'home-assistant') configTweaks.push('gpu_mem=16 (no display needed)');
  if (workload === 'desktop' || workload === 'kiosk') configTweaks.push('gpu_mem=128');
  if (bootMedia === 'nvme') configTweaks.push('dtparam=pciex1', `# ${NVME_CAVEAT}`);
  if (bootMedia === 'sd') configTweaks.push('SD card should support SDR104 high-speed mode for best throughput.');

  const recommendation = {
    image,
    alternative,
    boot_media: bootMedia,
    boot_media_notes: bootMedia === 'nvme' ? [NVME_CAVEAT] : [],
    config_txt_tweaks: configTweaks,
    package_list: workload === 'kiosk'
      ? ['chromium-browser', 'unclutter', 'xserver-xorg (or a minimal Wayland compositor)']
      : workload === 'media-center'
        ? ['jellyfin (or a Kodi image)']
        : workload === 'home-assistant'
          ? ['docker (only if using the container route, not HAOS)']
          : [],
    notes,
  };

  const rationale = `Based on the Pi 5 ${spec.ram_gb}GB tier (${spec.pcie}; ${spec.ethernet}) for a "${workload}" workload with boot_media_pref="${bootMediaPref}".`;

  const advisoryId = recordAdvisory(state, {
    boardId: board ? board.id : null,
    advisor: 'os_installer',
    workload,
    ramGb,
    inputs: { workload, boot_media_pref: bootMediaPref },
    recommendation,
    rationale,
  });

  return {
    success: true,
    output: {
      board_id: board ? board.id : null,
      ram_gb: ramGb,
      workload,
      recommendation,
      rationale,
      advisory_id: advisoryId,
    },
  };
}
