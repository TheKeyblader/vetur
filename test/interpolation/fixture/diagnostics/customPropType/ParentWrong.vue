<template>
  <div>
    <color-button :color="badColor" />
    <color-button :variant="badVariant" />
    <color-button :badge="badBadge" />
    <color-button color="tertiary" />
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import ColorButton from './ColorButton.vue';

export default Vue.extend({
  components: {
    ColorButton
  },
  computed: {
    badColor(): 'tertiary' {
      return 'tertiary';
    },
    badVariant(): 'ghost' {
      return 'ghost';
    },
    badBadge(): number {
      return 1;
    }
  }
});
</script>
