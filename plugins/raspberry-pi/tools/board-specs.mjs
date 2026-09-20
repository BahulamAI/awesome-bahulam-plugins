// Static reference data transcribed from the Raspberry Pi 5 product brief
// (RP-008348-DS-6). Baked in rather than parsed at runtime: this plugin
// ships no package.json, so a PDF-parsing dependency would be the wrong
// shape for data that's static per model/RAM tier anyway.

export const RAM_TIERS = [1, 2, 4, 8, 16];

const BASE = {
  model: 'Raspberry Pi 5',
  cpu: 'Broadcom BCM2712, quad-core 64-bit Arm Cortex-A76 @ 2.4GHz, 512KB per-core L2, 2MB shared L3',
  gpu: 'VideoCore VII (OpenGL ES 3.1, Vulkan 1.2) — no general-purpose matmul/NPU acceleration for LLM inference',
  ram_type: 'LPDDR4X-4267 SDRAM',
  wifi: 'Dual-band 802.11ac',
  bluetooth: 'Bluetooth 5.0 / BLE',
  usb3_ports: 2,
  usb2_ports: 2,
  ethernet: 'Gigabit Ethernet, PoE+ capable (requires a separate PoE+ HAT)',
  pcie: 'PCIe 2.0 x1 for fast peripherals (requires a separate M.2 HAT or other adapter for NVMe)',
  power: '5V/5A DC via USB-C, with Power Delivery support',
  gpio_header: 'Raspberry Pi standard 40-pin header',
  operating_temp_c: [0, 70],
};

function tier(ramGb, listPriceUsd) {
  return { ...BASE, ram_gb: ramGb, list_price_usd: listPriceUsd };
}

export const PI_BOARD_SPECS = {
  'pi5-1gb': tier(1, 45),
  'pi5-2gb': tier(2, 65),
  'pi5-4gb': tier(4, 110),
  'pi5-8gb': tier(8, 175),
  'pi5-16gb': tier(16, 305),
};

/** Nearest-at-or-below known RAM tier for a given amount of RAM, in GB. */
export function resolveSpec(ramGb) {
  const n = Number(ramGb);
  if (!Number.isFinite(n) || n < 1) throw new Error('ram_gb must be a positive number (GB)');
  const tierGb = [...RAM_TIERS].reverse().find(t => t <= n) || RAM_TIERS[0];
  return PI_BOARD_SPECS[`pi5-${tierGb}gb`];
}
