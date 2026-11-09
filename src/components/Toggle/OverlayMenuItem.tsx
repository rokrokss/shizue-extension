import { Theme } from '@/hooks/layout';
import { Tooltip } from 'antd';
import { forwardRef, ReactNode, useState } from 'react';

export interface OverlayMenuItemProps {
  icon: ReactNode;
  theme: Theme;
  popoverContent?: ReactNode;
  isPopoverOpen?: boolean;
  tooltipMessage: string;
  onClick?: () => void;
  hideTooltip?: boolean;
}

const OverlayMenuItem = forwardRef<HTMLDivElement, OverlayMenuItemProps>(
  (
    { theme, icon, popoverContent, isPopoverOpen, tooltipMessage, onClick, hideTooltip },
    triggerRef
  ) => {
    // The tooltip follows the pointer itself. Left to antd, it missed the pointer leaving while
    // hideTooltip held it shut, and came back with no pointer on it once the popover closed.
    const [hovering, setHovering] = useState(false);
    return (
      <>
        <Tooltip
          placement="left"
          title={
            <div
              className={`sz:text-black sz:font-ycom sz:z-2147483647 ${
                theme == 'dark' ? 'sz:text-white' : 'sz:text-black'
              }`}
            >
              {tooltipMessage}
            </div>
          }
          color={theme == 'dark' ? '#505362' : 'white'}
          open={hovering && !hideTooltip}
        >
          <div
            className="sz:cursor-pointer sz:rounded-full sz:flex sz:items-center sz:justify-center"
            style={{
              width: 34,
              height: 34,
              transition: 'background-color 0.1s',
            }}
            onMouseEnter={(e) => {
              setHovering(true);
              e.currentTarget.style.backgroundColor = 'rgba(203, 251, 246, 0.5)';
            }}
            onMouseLeave={(e) => {
              setHovering(false);
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
            ref={triggerRef}
          >
            <div
              className="sz:flex sz:items-center sz:justify-center"
              style={{
                width: 23,
                height: 23,
              }}
            >
              {icon}
            </div>
          </div>
        </Tooltip>
        {isPopoverOpen && popoverContent && popoverContent}
      </>
    );
  }
);

export default OverlayMenuItem;
