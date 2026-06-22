<script lang="ts">
import { Vue, Component, VModel, ModelSync, PropSync } from 'vue-property-decorator';

export type ColorToken = 'primary' | 'secondary';

/**
 * Exercises completion for the "model" family of vue-property-decorator decorators.
 */
@Component
export default class ModelButton extends Vue {
  /**
   * `@VModel` -> `value` prop (string union) + `input` event.
   */
  @VModel({ type: String, default: 'primary' }) readonly model!: ColorToken;

  /**
   * `@ModelSync` -> `count` prop + `count-change` event.
   */
  @ModelSync('count', 'count-change', { type: Number, default: 0 }) readonly countModel!: number;

  /**
   * `@PropSync` -> `shade` prop (string union) + `update:shade` event.
   */
  @PropSync('shade', { type: String, default: 'primary' }) readonly syncedShade!: ColorToken;
}
</script>
