<script lang="ts">
  import type { OfficeTheme } from '@backoffice/core';
  import { useTask, useThrelte } from '@threlte/core';
  import { N8AOPostPass } from 'n8ao';
  import {
    BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset,
    ToneMappingEffect, ToneMappingMode, VignetteEffect,
  } from 'postprocessing';
  import * as THREE from 'three';

  let { theme }: { theme: OfficeTheme<unknown> } = $props();

  const { scene, renderer, camera, size, autoRender, renderStage } = useThrelte();
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });

  // The chain is rebuilt when the camera or the theme changes: render, contact shadows, glow, grade, smooth edges.
  $effect(() => {
    const cam = $camera;
    const fx = theme.postFx;
    composer.removeAllPasses();
    composer.addPass(new RenderPass(scene, cam));
    if (fx.ambientOcclusion.enabled) {
      const ao = new N8AOPostPass(scene, cam, $size.width, $size.height);
      ao.configuration.aoRadius = fx.ambientOcclusion.radius;
      ao.configuration.intensity = fx.ambientOcclusion.intensity;
      ao.configuration.distanceFalloff = 1;
      ao.setQualityMode('Medium');
      composer.addPass(ao);
    }
    composer.addPass(
      new EffectPass(
        cam,
        new BloomEffect({ intensity: fx.bloom.intensity, luminanceThreshold: fx.bloom.threshold, luminanceSmoothing: 0.2, mipmapBlur: true }),
        new VignetteEffect({ darkness: fx.vignette, offset: 0.3 }),
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      ),
    );
    composer.addPass(new EffectPass(cam, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
  });

  $effect(() => {
    composer.setSize($size.width, $size.height);
  });

  // This component draws the frame itself, so Threlte's own draw is switched off while it is mounted.
  $effect(() => {
    const before = autoRender.current;
    autoRender.set(false);
    return () => {
      autoRender.set(before);
      composer.dispose();
    };
  });

  useTask((delta) => composer.render(delta), { stage: renderStage, autoInvalidate: false });
</script>
