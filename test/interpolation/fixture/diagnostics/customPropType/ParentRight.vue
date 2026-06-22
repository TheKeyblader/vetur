<template>
  <div>
    <color-button :color="okColor" />
    <color-button :variant="okVariant" />
    <color-button :tokens="okTokens" />
    <color-button :badge="okBadge" />
    <color-button color="secondary" />
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
    okColor(): 'secondary' {
      return 'secondary';
    },
    okVariant(): 'outline' {
      return 'outline';
    },
    okTokens(): ('primary' | 'secondary')[] {
      return ['primary', 'secondary'];
    },
    okBadge(): { count: number; color: 'primary' | 'secondary'; label?: string } {
      return { count: 3, color: 'secondary' };
    }
  }
});
</script>
