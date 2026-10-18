import fs from 'fs';
import { PNG } from 'pngjs';

function createIcon(size, isMaskable) {
  const png = new PNG({ width: size, height: size });
  
  // Brand colors
  const bgR = 0x16, bgG = 0x65, bgB = 0x34; // #166534
  const leafR = 0x22, leafG = 0xc5, leafB = 0x5e; // #22c55e
  const lightR = 0x86, lightG = 0xef, lightB = 0xac; // #86efac
  const whiteR = 0xff, whiteG = 0xff, whiteB = 0xff;
  const greenHeadR = 0x15, greenHeadG = 0x80, greenHeadB = 0x3d;

  const center = size / 2;
  const radius = size * (isMaskable ? 0.48 : 0.44);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Squircle or circle background
      const cornerR = size * 0.22;
      const inBoxX = Math.abs(dx) <= (size / 2 - cornerR);
      const inBoxY = Math.abs(dy) <= (size / 2 - cornerR);
      let inBackground = isMaskable;

      if (!isMaskable) {
        if (inBoxX || inBoxY) {
          inBackground = Math.abs(dx) <= size * 0.46 && Math.abs(dy) <= size * 0.46;
        } else {
          const cornerDist = Math.sqrt(
            Math.pow(Math.abs(dx) - (size * 0.46 - cornerR), 2) +
            Math.pow(Math.abs(dy) - (size * 0.46 - cornerR), 2)
          );
          inBackground = cornerDist <= cornerR;
        }
      }

      if (!inBackground) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }

      // Base background color with subtle vertical gradient
      const gradFactor = y / size;
      let r = Math.round(bgR * (1 - gradFactor * 0.15));
      let g = Math.round(bgG * (1 - gradFactor * 0.15));
      let b = Math.round(bgB * (1 - gradFactor * 0.15));
      let a = 255;

      // Calendar card dimensions
      const calLeft = size * 0.23;
      const calRight = size * 0.77;
      const calTop = size * 0.28;
      const calBottom = size * 0.78;
      const calHeaderHeight = size * 0.13;
      const calCorner = size * 0.07;

      const inCalX = x >= calLeft && x <= calRight;
      const inCalY = y >= calTop && y <= calBottom;

      if (inCalX && inCalY) {
        // Inside calendar card
        const isHeader = y <= calTop + calHeaderHeight;
        if (isHeader) {
          r = greenHeadR;
          g = greenHeadG;
          b = greenHeadB;
        } else {
          r = whiteR;
          g = whiteG;
          b = whiteB;
        }

        // Calendar Rings
        const pin1X = size * 0.35;
        const pin2X = size * 0.65;
        const pinY = calTop;
        const pinW = size * 0.055;
        const pinH = size * 0.11;

        // Leaf inside calendar body
        if (!isHeader) {
          const leafCenterX = size * 0.5;
          const leafCenterY = size * 0.58;
          const lx = (x - leafCenterX) / (size * 0.2);
          const ly = (y - leafCenterY) / (size * 0.2);

          // Leaf shape condition
          if (lx * lx + ly * ly <= 0.6 && (lx - ly) <= 0.3) {
            r = leafR;
            g = leafG;
            b = leafB;
          }
        }
      }

      // Pin hooks
      const pin1Dist = Math.abs(x - size * 0.36);
      const pin2Dist = Math.abs(x - size * 0.64);
      if ((pin1Dist < size * 0.025 || pin2Dist < size * 0.025) && y >= calTop - size * 0.05 && y <= calTop + size * 0.04) {
        r = 0xfa;
        g = 0xcc;
        b = 0x15; // Yellow pin
      }

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }

  return png;
}

const p192 = createIcon(192, false);
p192.pack().pipe(fs.createWriteStream('public/icon-192.png'));

const p512 = createIcon(512, false);
p512.pack().pipe(fs.createWriteStream('public/icon-512.png'));

const pMask = createIcon(512, true);
pMask.pack().pipe(fs.createWriteStream('public/icon-maskable-512.png'));

console.log('Generated PNG icons successfully');
