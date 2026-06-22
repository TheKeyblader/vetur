<script lang="ts">
import { Vue, Component, Prop } from 'vue-property-decorator';

export type ColorToken = 'primary' | 'secondary';

@Component
export default class ColorButton extends Vue {
  @Prop({ default: 'primary' }) readonly color!: ColorToken;
}
</script>
