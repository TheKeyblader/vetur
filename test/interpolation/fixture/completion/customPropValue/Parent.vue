<template>
  <div>
    <color-button color="" />
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import ColorButton from './Child.vue';

export default Vue.extend({
  components: {
    ColorButton
  }
});
</script>
