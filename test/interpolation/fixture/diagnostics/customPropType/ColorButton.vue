<script lang="ts">
import { Vue, Component, Prop } from 'vue-property-decorator';

export type ColorToken = 'primary' | 'secondary';

/**
 * A named interface used as a prop type.
 */
export interface Badge {
  count: number;
  color: ColorToken;
  label?: string;
}

/**
 * A button restricted to design-system color tokens.
 */
@Component
export default class ColorButton extends Vue {
  /**
   * Color token of the button.
   * The decorator carries no runtime type, the contract is the `ColorToken` annotation.
   */
  @Prop({ default: 'primary' }) readonly color!: ColorToken;

  /**
   * Visual variant.
   * The decorator only knows `String`, the precise type comes from the annotation.
   */
  @Prop({ type: String, default: 'solid' }) readonly variant!: 'solid' | 'outline';

  /**
   * A list of color tokens (custom type inside an array).
   */
  @Prop({ default: () => [] }) readonly tokens!: ColorToken[];

  /**
   * A named interface prop. The interface is expanded structurally so it is
   * type-checked even though `Badge` is not in scope in the parent template.
   */
  @Prop({ default: () => ({ count: 0, color: 'primary' }) }) readonly badge!: Badge;
}
</script>
