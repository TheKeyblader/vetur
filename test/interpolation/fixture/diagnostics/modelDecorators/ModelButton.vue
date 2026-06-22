<script lang="ts">
import { Vue, Component, VModel, ModelSync, PropSync } from 'vue-property-decorator';

export type ColorToken = 'primary' | 'secondary';

/**
 * Exercises the "model" family of vue-property-decorator decorators. Each declares a prop
 * whose real type is the property annotation (the decorator only knows the runtime type).
 */
@Component
export default class ModelButton extends Vue {
  /**
   * `@VModel` declares the v-model `value` prop (type taken from this annotation) and
   * emits `input`. The property itself is the computed proxy.
   */
  @VModel({ type: String, default: 'primary' }) readonly model!: ColorToken;

  /**
   * `@ModelSync` declares the v-model-bound `count` prop and emits `count-change`.
   */
  @ModelSync('count', 'count-change', { type: Number, default: 0 }) readonly countModel!: number;

  /**
   * `@PropSync` declares the `shade` prop and emits `update:shade`.
   */
  @PropSync('shade', { type: String, default: 'primary' }) readonly syncedShade!: ColorToken;
}
</script>
