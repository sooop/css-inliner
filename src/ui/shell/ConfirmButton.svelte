<script lang="ts">
  /** 되돌릴 수 없는 동작용 2단계 버튼: 처음 누르면 '정말?' 로 바뀌고 3초 안에 다시 눌러야 실행된다. */
  interface Props {
    label: string;
    confirmLabel?: string;
    disabled?: boolean;
    small?: boolean;
    onconfirm: () => void;
  }
  let { label, confirmLabel = '정말 삭제?', disabled = false, small = true, onconfirm }: Props = $props();
  let armed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function click() {
    if (!armed) {
      armed = true;
      timer = setTimeout(() => (armed = false), 3000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    onconfirm();
  }
</script>

<button type="button" class="btn dng" class:sm={small} class:armed {disabled} onclick={click} onblur={() => (armed = false)}>
  {armed ? confirmLabel : label}
</button>
