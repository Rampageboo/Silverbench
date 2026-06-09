function bootstrapAppCore() {
  const topbarControls = createTopbarControls();
  const el = buildEl(topbarControls);

  Object.assign(globalThis, {
    IMAGE_EXTENSIONS,
    state,
    galleryVirtual,
    bitmapCache,
    mergeState,
    cropState,
    maskNoiseState,
    videoState,
    classifierState,
    topbarControls,
    el,
    selectedClassRenderToken: 0
  });

  return { topbarControls, el };
}

bootstrapAppCore();
