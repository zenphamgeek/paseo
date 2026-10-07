import { memo } from "react";
import Svg, { Path } from "react-native-svg";

export interface TelegramIconProps {
  size?: number;
  color?: string;
}

export const TelegramIcon = memo(function TelegramIcon({
  size = 16,
  color = "currentColor",
}: TelegramIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21.9 2.1c-.3-.2-.8-.2-1.2 0L2.4 9.8c-.5.2-.8.8-.6 1.3.1.4.5.7.9.8l4.8 1.8 1.8 5.6c.2.5.7.9 1.3.8.4 0 .8-.2 1-.5l2.6-2.9 4.6 3.4c.3.2.7.3 1.1.2.4-.1.7-.4.8-.8l3.1-16.1c.1-.5-.1-1-.5-1.3zm-2.8 3.3L8.8 14.1l-.3 3.2-1.2-3.8 11.8-8.1z"
        fill={color}
      />
    </Svg>
  );
});
