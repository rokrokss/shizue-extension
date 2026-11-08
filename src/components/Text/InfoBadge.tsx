import { useThemeValue } from '@/hooks/layout';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';

// An (i) beside a setting's name or a menu row. Its description shows on hover or keyboard focus,
// so the list around it keeps only names and controls. Styled like the other tooltips and the
// gray secondary controls (thinking and agent step toggles).
export default function InfoBadge({ text }: { text: string }) {
  const theme = useThemeValue();
  return (
    <Tooltip
      placement="top"
      trigger={['hover', 'focus']}
      title={
        <div
          className={`sz:font-ycom sz:z-2147483647 sz:break-keep sz:wrap-anywhere ${
            theme == 'dark' ? 'sz:text-white' : 'sz:text-black'
          }`}
        >
          {text}
        </div>
      }
      color={theme == 'dark' ? '#505362' : 'white'}
      className="sz:font-ycom"
    >
      <button
        type="button"
        aria-label={text}
        className={`sz:inline-flex sz:items-center sz:shrink-0 sz:rounded-sm sz:cursor-default sz:text-gray-500 sz:focus-visible:outline-2 sz:focus-visible:outline-sz-cyan ${
          theme == 'dark' ? 'sz:hover:text-gray-300' : 'sz:hover:text-gray-700'
        }`}
      >
        <InfoCircleOutlined style={{ fontSize: '13px' }} />
      </button>
    </Tooltip>
  );
}
